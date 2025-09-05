use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Burn, Token, TokenAccount, Transfer},
};

// maximum number of underlying assets supported
pub const MAX_ASSETS: usize = 8;

declare_id!("HxGs1wgKnbVgC2FxqmgN7RcpuuaePbQUT5g3bNYBrPAo");

// helper: gcd for u64
fn gcd_u64(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        let t = a % b;
        a = b;
        b = t;
    }
    a
}

#[program]
pub mod composite_vault {
    use super::*;
    

    /// Combined initialize + deposit + mint instruction.
    /// - On first call: initializes composite mint, config PDA, and vault ATAs (for PDA owner) using init_if_needed / associated token CPI.
    /// - On subsequent calls: skips init and performs deposit+mint only.
    /// - Parameters:
    ///    - amounts_per_unit: used for initialization; when config already exists we verify it matches stored config.
    ///    - amounts: deposit amounts for each underlying asset (length must equal num_assets)
    ///    - composite_decimals: used only when initializing the composite mint (e.g., 0)
    #[allow(clippy::too_many_arguments)]
    pub fn deposit_and_mint_with_init<'info>(
        ctx: Context<'_, '_, '_, 'info, DepositAndMintWithInit<'info>>,
        amounts_per_unit: Vec<u64>,
        amounts: Vec<u64>,
        composite_decimals: u8,
    ) -> Result<()> {
        // Validate amounts_per_unit on call (must be non-empty and not exceed MAX_ASSETS)
        require!(!amounts_per_unit.is_empty(), CompositeError::InvalidUnit);
        require!(amounts_per_unit.len() <= MAX_ASSETS as usize, CompositeError::TooManyAssets);

        // Determine whether this is first-time init (config.num_assets == 0) or subsequent call
        let mut n: usize;
        let is_init = ctx.accounts.config.num_assets == 0;

        if is_init {
            // First-call initialization: use provided amounts_per_unit to set up config
            n = amounts_per_unit.len();
            require!(ctx.remaining_accounts.len() >= n * 3, CompositeError::MissingAccounts);

            // Fill config
            let config = &mut ctx.accounts.config;
            config.authority = ctx.accounts.user.key();
            config.num_assets = n as u8;
            // normalize amounts_per_unit by gcd so stored per-unit is minimal integers
            let mut gcd_all: u64 = amounts_per_unit[0];
            for i in 1..n {
                gcd_all = gcd_u64(gcd_all, amounts_per_unit[i]);
            }

            for i in 0..n {
                config.mints[i] = ctx.remaining_accounts[i].key();
                // divide by gcd to store normalized per-unit
                config.amounts_per_unit[i] = amounts_per_unit[i] / gcd_all;
            }
            // store the original gcd so we can scale normalized units back to raw token amounts
            config.unit_scale = gcd_all;
            config.composite_mint = ctx.accounts.composite_mint.key();
            config.mint_authority = ctx.accounts.mint_auth.key();

            // store bumps
            config.bump_config = ctx.bumps.config;
            config.bump_mint_auth = ctx.bumps.mint_auth;

            // sanity checks on newly created composite mint
            require_keys_eq!(ctx.accounts.composite_mint.mint_authority.unwrap(), ctx.accounts.mint_auth.key(), CompositeError::BadMintAuth);
            require!(ctx.accounts.composite_mint.decimals == composite_decimals, CompositeError::BadDecimals);

            msg!("deposit_and_mint_with_init: performed first-time init: num_assets={} gcd={}", n, gcd_all);
        } else {
            // Subsequent call: validate provided amounts_per_unit matches stored config (to preserve validation)
            n = ctx.accounts.config.num_assets as usize;
            require!(amounts_per_unit.len() == n, CompositeError::WrongArgumentLength);
            // Allow callers to provide either the same normalized per-unit amounts stored in config
            // or the original un-normalized amounts (scaled by a common gcd). To support the latter,
            // compute the gcd of the provided vector and compare the normalized values to the stored
            // config.amounts_per_unit.
            let mut provided_gcd: u64 = amounts_per_unit[0];
            for i in 1..n {
                provided_gcd = gcd_u64(provided_gcd, amounts_per_unit[i]);
            }
            for i in 0..n {
                // provided must be divisible by gcd
                require!(provided_gcd > 0, CompositeError::InvalidUnit);
                require!(amounts_per_unit[i] % provided_gcd == 0, CompositeError::InvalidUnit);
                let normalized = amounts_per_unit[i] / provided_gcd;
                require!(normalized == ctx.accounts.config.amounts_per_unit[i], CompositeError::InvalidUnit);
            }
            require!(ctx.remaining_accounts.len() >= n * 3, CompositeError::MissingAccounts);
            msg!("deposit_and_mint_with_init: skipping init (config already exists) num_assets={}", n);
        }

        // Now run the deposit validation logic (preserve original checks)
        require!(n > 0, CompositeError::ZeroAssets);
        require!(amounts.len() == n, CompositeError::WrongArgumentLength);

        // Validate each deposit and compute k for each; ensure all k are equal
        let mut k_opt: Option<u64> = None;
        for i in 0..n {
            let amount = amounts[i];
            // Use the provided amounts_per_unit for k computation. When this is the first
            // call (is_init), the provided values will be un-normalized and used directly.
            // On subsequent calls we validated that the provided vector (maybe scaled by a
            // gcd) matches the stored normalized config, so using the provided values here
            // yields the caller-expected k.
            let per_unit = amounts_per_unit[i];
            require!(amount > 0, CompositeError::ZeroAmount);
            require!(per_unit > 0, CompositeError::InvalidUnit);
            require!(amount % per_unit == 0, CompositeError::NonMultipleDeposit);
            let k_i = amount / per_unit;
            if let Some(kv) = k_opt {
                require!(kv == k_i, CompositeError::RatioMismatch);
            } else {
                k_opt = Some(k_i);
            }
        }
        let k = k_opt.unwrap();
        require!(k > 0, CompositeError::ZeroMint);

        // Diagnostic: dump remaining accounts info (keys and owners) to help debug InvalidAccountData
        for (idx, acc) in ctx.remaining_accounts.iter().enumerate() {
            msg!("rem[{}] = {} owner={}", idx, acc.key(), acc.owner);
        }

        // Ensure vault ATAs exist (create if not present) - expected remaining_accounts order:
        // [mint_0..mint_n-1, vault_0..vault_n-1, user_token_0..user_token_n-1]
        for i in 0..n {
            let mint_info = &ctx.remaining_accounts[i];
            let vault_info = &ctx.remaining_accounts[n + i];

            // If vault ATA does not yet exist (data len == 0), create via associated token CPI.
            if vault_info.try_borrow_data()?.len() == 0 {
                msg!("creating vault ATA for mint {} -> {}", mint_info.key(), vault_info.key());
               let cpi_accounts = anchor_spl::associated_token::Create {
    payer: ctx.accounts.user.to_account_info(),
    associated_token: vault_info.to_account_info(),
    authority: ctx.accounts.mint_auth.to_account_info(),
    mint: mint_info.to_account_info(),
    system_program: ctx.accounts.system_program.to_account_info(),
    token_program: ctx.accounts.token_program.to_account_info(),
    // rent: ctx.accounts.rent.to_account_info(),  <-- REMOVE this line
};
let cpi_ctx = CpiContext::new(ctx.accounts.associated_token_program.to_account_info(), cpi_accounts);
anchor_spl::associated_token::create(cpi_ctx)?;
            }
        }

        // Transfer each user's underlying to corresponding vault
        for i in 0..n {
            let user_token_info = &ctx.remaining_accounts[n * 2 + i];
            let vault_info = &ctx.remaining_accounts[n + i];
            let amount = amounts[i];

            msg!("deposit: i={} user_token={} vault={}", i, user_token_info.key(), vault_info.key());
            // Diagnostic: print owner and data length for the accounts used in CPI
            msg!("user_token owner={} data_len={}", user_token_info.owner, user_token_info.try_borrow_data()?.len());
            msg!("vault owner={} data_len={}", vault_info.owner, vault_info.try_borrow_data()?.len());

            let cpi_accounts = Transfer {
                from: user_token_info.to_account_info(),
                to: vault_info.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            };
            let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
            token::transfer(cpi_ctx, amounts[i])?;
        }

        // Mint k composite tokens to user_composite ATA
        let config_key = ctx.accounts.config.key();
        let seeds = &[
            b"mint_auth",
            config_key.as_ref(),
            &[ctx.bumps.mint_auth],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.composite_mint.to_account_info(),
            to: ctx.accounts.user_composite.to_account_info(),
            authority: ctx.accounts.mint_auth.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );

        // With decimals=0 on composite mint, 1 token == 1 basket
        token::mint_to(cpi_ctx, k)?;

        Ok(())
    }

    /// Redeem function preserved as before (no changes required)
    pub fn redeem_and_withdraw<'info>(
        ctx: Context<'_, '_, '_, 'info, RedeemAndWithdraw<'info>>,
        amount_composite: u64,
    ) -> Result<()> {
        let config = &ctx.accounts.config;

        // Validate composite mint matches config
        require_keys_eq!(config.composite_mint, ctx.accounts.composite_mint.key(), CompositeError::WrongMint);
        require!(amount_composite > 0, CompositeError::ZeroAmount);

        // Diagnostic: print named account keys Anchor passed into the instruction
        msg!("named:user={}", ctx.accounts.user.key());
        msg!("named:composite_mint={}", ctx.accounts.composite_mint.key());
        msg!("named:config={}", ctx.accounts.config.key());
        msg!("named:mint_auth={}", ctx.accounts.mint_auth.key());
        msg!("named:user_composite={}", ctx.accounts.user_composite.key());
        msg!("named:system_program={}", ctx.accounts.system_program.key());
        msg!("named:rent={}", ctx.accounts.rent.key());

        // Diagnostic: show the actual pubkeys passed as program accounts
        msg!("named:system_program_key={}", ctx.accounts.system_program.key());
        msg!("named:token_program_key={}", ctx.accounts.token_program.key());
        msg!("named:associated_token_program_key={}", ctx.accounts.associated_token_program.key());

        // Dump remaining_accounts keys
        for (i, a) in ctx.remaining_accounts.iter().enumerate() {
            msg!("rem[{}]={}", i, a.key());
        }

        // Burn composite tokens from user's composite ATA (authority = user)
        let cpi_accounts = Burn {
            mint: ctx.accounts.composite_mint.to_account_info(),
            from: ctx.accounts.user_composite.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::burn(cpi_ctx, amount_composite)?;

    // For each asset, transfer amount_composite * per_unit * unit_scale from vault -> user
    let n = config.num_assets as usize;
        require!(n > 0, CompositeError::ZeroAssets);
        require!(ctx.remaining_accounts.len() >= n * 2, CompositeError::MissingAccounts);

        let config_key = ctx.accounts.config.key();
        let seeds = &[
            b"mint_auth",
            config_key.as_ref(),
            &[ctx.bumps.mint_auth],
        ];
        let signer = &[&seeds[..]];

        for i in 0..n {
            let per = config.amounts_per_unit[i];
            // scale normalized per-unit by stored unit_scale to get raw token units
            let scaled_per = per.checked_mul(config.unit_scale).ok_or(ProgramError::Custom(6009))?;
            let amt = amount_composite.checked_mul(scaled_per).ok_or(ProgramError::Custom(6008))?;
            let vault_info = &ctx.remaining_accounts[i + n];
            let user_token_info = &ctx.remaining_accounts[i + n + n];

            msg!("redeem: i={} vault={} user_token={}", i, vault_info.key(), user_token_info.key());
            // Use Anchor CPI for token transfer from vault to user
            let cpi_accounts = Transfer {
                from: vault_info.to_account_info(),
                to: user_token_info.to_account_info(),
                authority: ctx.accounts.mint_auth.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer,
            );
            token::transfer(cpi_ctx, amt)?;
        }

        Ok(())
    }
}

/* ---------------------- ACCOUNTS ---------------------- */

#[derive(Accounts)]
#[instruction(amounts_per_unit: Vec<u64>, composite_decimals: u8)]
pub struct DepositAndMintWithInit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// Composite mint (created here if missing). Recommend decimals = 0 for clean unit semantics.
    #[account(
        init_if_needed,
        payer = user,
        mint::decimals = composite_decimals,
        mint::authority = mint_auth,
        mint::freeze_authority = mint_auth
    )]
    pub composite_mint: Account<'info, Mint>,

    /// Config PDA: one per composite_mint — create if needed
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + CompositeConfig::LEN,
        seeds = [b"config", composite_mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, CompositeConfig>,

    /// PDA used as mint authority for the composite mint and owner of vault ATAs
    /// CHECK: PDA derived and verified via seeds
    #[account(
        seeds = [b"mint_auth", config.key().as_ref()],
        bump
    )]
    pub mint_auth: UncheckedAccount<'info>,

    /// User’s destination composite ATA (auto-create if missing)
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = composite_mint,
        associated_token::authority = user
    )]
    pub user_composite: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    /// SPL Token program for CPI
    pub token_program: Program<'info, Token>,
    /// Associated Token program for ATA init CPI
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct RedeemAndWithdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// Composite mint
    #[account(mut, address = config.composite_mint)]
    pub composite_mint: Account<'info, Mint>,

    #[account(
        seeds = [b"config", composite_mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, CompositeConfig>,

    /// PDA that owns the vaults and mints the composite
    /// CHECK: PDA verified by seeds
    #[account(
        seeds = [b"mint_auth", config.key().as_ref()],
        bump
    )]
    pub mint_auth: UncheckedAccount<'info>,

    /// User's composite ATA to burn from
    #[account(mut)]
    pub user_composite: Account<'info, TokenAccount>,

    // --- Programs (strict order) ---
    pub system_program: Program<'info, System>,
    #[account(address = anchor_spl::token::ID)]
    pub token_program: Program<'info, Token>,
    #[account(address = anchor_spl::associated_token::ID)]
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

/* ---------------------- STATE ---------------------- */

#[account]
pub struct CompositeConfig {
    pub authority: Pubkey,        // who initialized
    pub composite_mint: Pubkey,
    pub mint_authority: Pubkey,   // PDA that owns vaults and mints
    pub num_assets: u8,
    // fixed-size arrays for mints and per-unit amounts; only first num_assets entries are valid
    pub mints: [Pubkey; MAX_ASSETS],
    pub amounts_per_unit: [u64; MAX_ASSETS],
    pub unit_scale: u64, // gcd used to scale normalized per-unit amounts into raw token units
    pub bump_config: u8,
    pub bump_mint_auth: u8,
}

impl CompositeConfig {
    // size calc
    pub const LEN: usize =
        32 + // authority
        32 + // composite_mint
        32 + // mint_authority
        1  + // num_assets
        (32 * MAX_ASSETS) + // mints array
        (8 * MAX_ASSETS)  + // amounts_per_unit array
    8  + // unit_scale
        1  + // bump_config
        1;   // bump_mint_auth
}

/* ---------------------- ERRORS ---------------------- */

#[error_code]
pub enum CompositeError {
    #[msg("Invalid per-unit amounts")]
    InvalidUnit,
    #[msg("Composite mint has wrong authority")]
    BadMintAuth,
    #[msg("Composite mint has unexpected decimals")]
    BadDecimals,
    #[msg("Wrong mint passed to instruction")]
    WrongMint,
    #[msg("Zero amounts are not allowed")]
    ZeroAmount,
    #[msg("Deposit must be an exact multiple of the configured per-unit amount")]
    NonMultipleDeposit,
    #[msg("Deposits do not match the required ratio")]
    RatioMismatch,
    #[msg("Mint amount computed to zero")]
    ZeroMint,
    #[msg("Too many assets configured")]
    TooManyAssets,
    #[msg("Missing remaining accounts for dynamic assets")]
    MissingAccounts,
    #[msg("Wrong number of arguments provided")]
    WrongArgumentLength,
    #[msg("Zero assets configured")]
    ZeroAssets,
}
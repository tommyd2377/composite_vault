import TokenLeaderboard from "@/components/TokenLeaderboard";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTwitter, faGithub, faTelegram, faLinkedin } from "@fortawesome/free-brands-svg-icons";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-gradient-to-b from-gray-950 via-gray-900 to-black">
      <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))] opacity-10"></div>

      <div className="relative z-10 mb-8 text-center">
        <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-purple-400 to-blue-500 text-transparent bg-clip-text">
          Blndr
        </h1>
        <p className="text-gray-400">
          Create custom token blends with ease
        </p>
      </div>

      <div className="relative z-10 w-full flex flex-col lg:flex-row items-start gap-6">
  {/* Counter UI removed (unused) */}
        <div className="flex-1 max-w-2xl w-full">
          <TokenLeaderboard />
        </div>
      </div>

      <footer style={{ textAlign: 'center', paddingTop: '20px' }}>
  <p style={{ marginTop: '20px', fontWeight: 'bold', fontSize: '1rem', background: 'linear-gradient(to right, #9945FF, #14F195)', WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent' }}>Presented by Thomas DeVito</p>
  <div style={{ display: 'flex', justifyContent: 'center', marginTop: '2px' }}>
    <a href="https://x.com/thomasfdevito" target="_blank" rel="noopener noreferrer">
      <FontAwesomeIcon icon={faTwitter} style={{ margin: '0 10px', fontSize: '24px', color: 'white' }} />
    </a>
    <a href="https://telegram.com" target="_blank" rel="noopener noreferrer">
      <FontAwesomeIcon icon={faTelegram} style={{ margin: '0 10px', fontSize: '24px', color: 'white' }} />
    </a>
    <a href="https://www.linkedin.com/in/tdevito" target="_blank" rel="noopener noreferrer">
      <FontAwesomeIcon icon={faLinkedin} style={{ margin: '0 10px', fontSize: '24px', color: 'white' }} />
    </a>
    <a href="https://github.com/tommyd2377" target="_blank" rel="noopener noreferrer">
      <FontAwesomeIcon icon={faGithub} style={{ margin: '0 10px', fontSize: '24px', color: 'white' }} />
    </a>
  </div>
  <br />
  <div style={{
  fontFamily: 'Arial, sans-serif',
  fontSize: '16px',
  textAlign: 'center',
  color: '#333'
}}>
  Made with <span style={{ color: '#e25555', fontSize: '24px' }}>&hearts;</span> in NYC
</div>
</footer>
    </div>
  );
}

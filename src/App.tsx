import React, { useState, useEffect } from 'react';
import ARViewer from './components/ARViewer';
import { QRCodeSVG } from 'qrcode.react';
import { Car, Users, Play, User } from 'lucide-react';

const COLORS = [
  { name: 'Blanco', hex: '#ffffff' },
  { name: 'Rojo', hex: '#ef4444' },
  { name: 'Azul', hex: '#3b82f6' },
  { name: 'Verde', hex: '#10b981' },
  { name: 'Amarillo', hex: '#eab308' },
  { name: 'Morado', hex: '#a855f7' },
  { name: 'Naranja', hex: '#f97316' },
  { name: 'Rosa', hex: '#ec4899' },
];

export default function App() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [joinUrl, setJoinUrl] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [playerColor, setPlayerColor] = useState('#ffffff');
  const [isNameSet, setIsNameSet] = useState(false);
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);

  useEffect(() => {
    // Check if URL has a room parameter (e.g., ?room=1234)
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room');
    if (roomFromUrl) {
      setPendingRoomId(roomFromUrl);
    }
  }, []);

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (playerName.trim()) {
      setIsNameSet(true);
      if (pendingRoomId) {
        setRoomId(pendingRoomId);
        setGameStarted(true); // Auto-start for clients who scan the QR
      }
    }
  };

  const createRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(newRoomId);
    
    // Construir la URL para el QR
    const url = `${window.location.origin}${window.location.pathname}?room=${newRoomId}`;
    setJoinUrl(url);
  };

  const startGame = () => {
    setGameStarted(true);
  };

  if (gameStarted && roomId) {
    return (
      <div className="h-screen w-screen bg-[#0a0a0a] text-white font-sans overflow-hidden">
        <ARViewer roomId={roomId} playerName={playerName} playerColor={playerColor} />
      </div>
    );
  }

  if (!isNameSet) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-4 font-sans">
        <div className="mb-12 flex flex-col items-center">
          <img 
            src="https://raw.githubusercontent.com/LOLAPALUPULO/COBRO/30f2e0a7defe3bfb8935c833ca8bc0b9da69eea7/lola.svg" 
            alt="Lola Logo" 
            className="w-32 h-32 mb-6 drop-shadow-[0_0_20px_rgba(16,185,129,0.3)]"
            referrerPolicy="no-referrer"
          />
          <h1 className="text-5xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white to-zinc-500">
            LOLA
          </h1>
          <p className="text-zinc-400 mt-2 font-medium tracking-wide uppercase text-sm">Multijugador AR</p>
        </div>

        <form onSubmit={handleNameSubmit} className="flex flex-col items-center bg-zinc-900/80 backdrop-blur-xl p-8 rounded-[2rem] border border-white/10 shadow-2xl max-w-sm w-full animate-in fade-in slide-in-from-bottom-8 duration-500">
          <h2 className="text-2xl font-bold mb-6 text-white text-center">Identifícate Piloto</h2>
          
          <div className="w-full relative mb-8">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <User size={20} className="text-zinc-500" />
            </div>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Tu nombre..."
              maxLength={12}
              className="w-full bg-zinc-950 border border-white/10 text-white rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
              required
            />
          </div>

          <div className="w-full mb-8">
            <p className="text-zinc-400 text-sm mb-3 text-center">Color del Vehículo</p>
            <div className="flex flex-wrap justify-center gap-3">
              {COLORS.map(c => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setPlayerColor(c.hex)}
                  className={`w-10 h-10 rounded-full border-2 transition-transform ${playerColor === c.hex ? 'border-emerald-500 scale-110' : 'border-transparent hover:scale-105'}`}
                  style={{ backgroundColor: c.hex }}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          <button 
            type="submit"
            disabled={!playerName.trim()}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 font-bold py-4 px-8 rounded-2xl text-lg transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <span>Continuar</span>
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-4 font-sans">
      <div className="mb-12 flex flex-col items-center">
        <img 
          src="https://raw.githubusercontent.com/LOLAPALUPULO/COBRO/30f2e0a7defe3bfb8935c833ca8bc0b9da69eea7/lola.svg" 
          alt="Lola Logo" 
          className="w-32 h-32 mb-6 drop-shadow-[0_0_20px_rgba(16,185,129,0.3)]"
          referrerPolicy="no-referrer"
        />
        <h1 className="text-5xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white to-zinc-500">
          LOLA
        </h1>
        <p className="text-zinc-400 mt-2 font-medium tracking-wide uppercase text-sm">Hola, {playerName}</p>
      </div>
      
      {!roomId ? (
        <button 
          onClick={createRoom}
          className="group relative bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold py-5 px-10 rounded-full text-xl transition-all active:scale-95 flex items-center gap-3 overflow-hidden"
        >
          <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></div>
          <Users size={24} className="relative z-10" />
          <span className="relative z-10">Crear Partida</span>
        </button>
      ) : (
        <div className="flex flex-col items-center bg-zinc-900/80 backdrop-blur-xl p-8 rounded-[2rem] border border-white/10 shadow-2xl max-w-sm w-full animate-in fade-in slide-in-from-bottom-8 duration-500">
          <h2 className="text-2xl font-bold mb-2 text-white">Sala Creada</h2>
          <div className="bg-zinc-950 py-2 px-6 rounded-full border border-white/5 mb-8">
            <p className="text-zinc-400 text-sm">Código: <span className="text-emerald-400 font-mono font-bold text-lg ml-2">{roomId}</span></p>
          </div>
          
          <div className="bg-white p-6 rounded-3xl mb-8 shadow-[0_0_40px_rgba(255,255,255,0.1)]">
            <QRCodeSVG 
              value={joinUrl} 
              size={220}
              level="H"
              includeMargin={false}
            />
          </div>
          
          <p className="text-center text-zinc-400 mb-8 text-sm leading-relaxed px-4">
            Pide a los demás jugadores que escaneen este código QR con su cámara para unirse.
          </p>

          <button 
            onClick={startGame}
            className="w-full bg-white hover:bg-zinc-200 text-zinc-950 font-bold py-4 px-8 rounded-2xl text-lg transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <Play size={20} />
            <span>Entrar a la Pista</span>
          </button>
        </div>
      )}
    </div>
  );
}

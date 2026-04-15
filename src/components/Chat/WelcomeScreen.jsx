import { Code, FileText, Image, Lightbulb, GraduationCap } from 'lucide-react';
import MiraLogo from '../common/MiraLogo';

const SUGGESTIONS = [
  { icon: Code, text: 'Help me write a React component', color: 'text-blue-400' },
  { icon: FileText, text: 'Draft a professional email', color: 'text-green-400' },
  { icon: Image, text: 'Generate an image of a sunset', color: 'text-orange-400' },
  { icon: Lightbulb, text: 'Explain quantum computing simply', color: 'text-yellow-400' },
  { icon: GraduationCap, text: 'Help me study for an exam', color: 'text-pink-400' },
  { icon: Code, text: 'Debug my Python code', color: 'text-cyan-400' },
];

export default function WelcomeScreen({ onSuggestionClick }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 pb-20">
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center mb-5 shadow-lg shadow-violet-500/20 rounded-2xl overflow-hidden">
          <MiraLogo size={64} className="rounded-2xl" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">
          How can I help you today?
        </h1>
        <p className="text-gray-400 max-w-md">
          I'm MIRA — your Multi-Intelligent Responsive Assistant. I can chat, code, create documents, generate images, and more.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl w-full">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={i}
            onClick={() => onSuggestionClick(s.text)}
            className="flex items-center gap-3 bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-600 rounded-xl px-4 py-3.5 text-left transition group"
          >
            <s.icon size={18} className={`${s.color} flex-shrink-0`} />
            <span className="text-sm text-gray-300 group-hover:text-white transition">
              {s.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

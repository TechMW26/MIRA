import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check, Volume2, VolumeX, User } from 'lucide-react';
import CodeBlock from './CodeBlock';
import { useState } from 'react';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="p-1 text-gray-500 hover:text-gray-300 transition"
      title="Copy message"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export default function MessageBubble({ message, isStreaming, streamingContent, onSpeak, isSpeaking, onStopSpeaking }) {
  const isUser = message.role === 'user';
  const content = isStreaming ? streamingContent : message.content;

  return (
    <div className={`message-enter py-4 ${isUser ? '' : ''}`}>
      <div className="max-w-3xl mx-auto px-4 flex gap-4">
        {/* Avatar */}
        <div className="flex-shrink-0 mt-1">
          {isUser ? (
            <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center">
              <User size={16} className="text-gray-300" />
            </div>
          ) : (
            <img src="/mira-logo.png" alt="MIRA" className="w-8 h-8 rounded-full object-cover" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-300 mb-1">
            {isUser ? 'You' : 'MIRA'}
          </div>

          <div className="text-gray-100">
            {isUser ? (
              <p className="whitespace-pre-wrap">{content}</p>
            ) : content ? (
              <div className={`prose prose-invert max-w-none prose-sm ${isStreaming ? 'typing-cursor' : ''}`}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    code({ inline, className, children, ...props }) {
                      if (inline) {
                        return (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      }
                      return (
                        <CodeBlock className={className}>
                          {String(children).replace(/\n$/, '')}
                        </CodeBlock>
                      );
                    },
                    img({ src, alt }) {
                      return (
                        <img
                          src={src}
                          alt={alt}
                          className="rounded-xl max-w-md shadow-lg"
                          loading="lazy"
                        />
                      );
                    },
                  }}
                >
                  {content}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-gray-400">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-violet-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-violet-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-violet-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-sm">Thinking...</span>
              </div>
            )}
          </div>

          {/* Actions */}
          {!isUser && !isStreaming && content && (
            <div className="flex items-center gap-1 mt-2">
              <CopyButton text={content} />
              {onSpeak && (
                <button
                  onClick={() => isSpeaking ? onStopSpeaking?.() : onSpeak(content)}
                  className="p-1 text-gray-500 hover:text-gray-300 transition"
                  title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
                >
                  {isSpeaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

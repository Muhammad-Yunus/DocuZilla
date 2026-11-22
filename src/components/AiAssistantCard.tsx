import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Brain,
  Mic,
  Plus,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { docuzillaApi } from '../lib/api.ts';
import type { AiMessage, AiMode, DocumentItem } from '../types/docuzilla.ts';
import { MarkdownMessage } from './MarkdownMessage.tsx';

interface AiAssistantCardProps {
  messages: AiMessage[];
  onMessagesUpdate: (msgs: AiMessage[]) => void;
  selectedDocForAi: DocumentItem | null;
  onClearSelectedDoc: () => void;
  onExpandAi?: () => void;
}

const AI_MODES: AiMode[] = ['GPT-4o', 'Document AI', 'Financial AI', 'Summary'];

function PdfAttachmentGraphic({ fileName }: { fileName: string }) {
  return (
    <div className="flex flex-col items-center my-2" title={fileName}>
      <div className="relative w-16 h-12 flex items-center justify-center">
        {/* Red PDF Icon rotated slightly left */}
        <div className="w-9 h-10 rounded-lg bg-white border-2 border-[#EF4444] shadow-sm -rotate-12 -translate-x-2.5 flex flex-col items-center justify-center">
          <div className="text-[8px] font-bold text-[#EF4444] tracking-tighter leading-none">
            T
          </div>
          <div className="mt-1 px-1 py-0.5 bg-[#EF4444] text-white text-[7px] font-bold rounded-sm leading-none">
            PDF
          </div>
        </div>
        {/* Blue Document Icon rotated slightly right */}
        <div className="w-9 h-10 rounded-lg bg-[#2563EB] shadow-md rotate-12 translate-x-2.5 flex flex-col justify-center gap-1 px-1.5">
          <div className="h-[2px] w-full bg-white/90 rounded-full" />
          <div className="h-[2px] w-4/5 bg-white/80 rounded-full" />
          <div className="h-[2px] w-3/5 bg-white/75 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export const AiAssistantCard: React.FC<AiAssistantCardProps> = ({
  messages,
  onMessagesUpdate,
  selectedDocForAi,
  onClearSelectedDoc,
  onExpandAi,
}) => {
  const [mode, setMode] = useState<AiMode>('GPT-4o');
  const [question, setQuestion] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  useEffect(() => {
    if (selectedDocForAi) {
      inputRef.current?.focus();
    }
  }, [selectedDocForAi]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed && !attachedFile && !selectedDocForAi) return;

    setSending(true);
    setErrorMsg(null);

    try {
      const res = await docuzillaApi.analyzeWithAi({
        question:
          trimmed ||
          `Process ${attachedFile?.name || selectedDocForAi?.fileName || 'document'} with ${mode}.`,
        mode,
        file: attachedFile,
        documentId: !attachedFile && selectedDocForAi ? selectedDocForAi.id : null,
      });

      const incoming = [res?.userMessage, res?.assistantMessage].filter(
        (m): m is AiMessage => Boolean(m && typeof m === 'object' && typeof m.role === 'string'),
      );
      if (incoming.length === 0) {
        throw new Error('AI Assistant returned an unexpected empty response.');
      }
      const existingSafe = (Array.isArray(messages) ? messages : []).filter(
        (m): m is AiMessage => Boolean(m && typeof m === 'object' && typeof m.role === 'string'),
      );
      onMessagesUpdate([...existingSafe, ...incoming]);
      setQuestion('');
      setAttachedFile(null);
      if (selectedDocForAi) onClearSelectedDoc();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to process PDF right now.');
    } finally {
      setSending(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAttachedFile(file);
      setErrorMsg(null);
      inputRef.current?.focus();
    }
    e.target.value = '';
  };

  const handleVoicePrompt = () => {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown })
        .webkitSpeechRecognition;

    if (!SpeechRecognition) {
      inputRef.current?.focus();
      return;
    }
    try {
      const recognition = new (SpeechRecognition as new () => {
        lang: string;
        onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        start: () => void;
      })();
      recognition.lang = 'en-US';
      recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          setQuestion((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      };
      recognition.start();
    } catch {
      inputRef.current?.focus();
    }
  };

  const formatMsgTime = (iso: string, index: number) => {
    if (index === 0) return '10:59';
    if (index === 2) return '11:00';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return '';
    }
  };

  return (
    <aside className="bg-white rounded-[22px] p-5 sm:p-6 shadow-[0_2px_16px_rgba(15,23,42,0.03)] border border-slate-100/80 flex flex-col justify-between h-full min-h-[460px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-[18px] h-[18px] text-[#3B66F5]" strokeWidth={1.8} />
          <h2 className="text-[15px] font-medium text-slate-900">AI Assistant</h2>
        </div>
        <button
          type="button"
          onClick={() => (onExpandAi ? onExpandAi() : fileInputRef.current?.click())}
          className="w-7 h-7 rounded-full border border-slate-100 bg-slate-50/70 hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-colors cursor-pointer"
          aria-label="Open AI PDF Workspace"
        >
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Chat Messages Timeline */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto thin-scrollbar pr-1 space-y-3 py-1 max-h-[340px] lg:max-h-[360px]"
      >
        {(Array.isArray(messages) ? messages : [])
          .filter((msg): msg is AiMessage => Boolean(msg && typeof msg === 'object' && typeof msg.role === 'string'))
          .map((msg, idx) => {
            const isAssistant = msg.role === 'assistant';
            const showTimestamp = idx === 0 || idx === 2 || idx > 2;
            return (
              <div key={msg.id ?? `ai-msg-${idx}`} className="space-y-1.5">
              {showTimestamp && (
                <div className="text-[10.5px] text-slate-400 tabular-nums">
                  {formatMsgTime(msg.createdAt, idx)}
                </div>
              )}

              {msg.attachmentName && !isAssistant && (
                <PdfAttachmentGraphic fileName={msg.attachmentName} />
              )}

              {isAssistant ? (
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full border border-slate-200 bg-white flex items-center justify-center shrink-0 mt-0.5">
                    <Brain className="w-3.5 h-3.5 text-slate-700" strokeWidth={1.6} />
                  </div>
                  <div className="bg-[#F3F5F9] text-slate-700 text-[12.5px] leading-[1.45] px-3.5 py-2.5 rounded-2xl rounded-tl-md max-w-[88%] min-w-0">
                    <MarkdownMessage content={msg.content || ''} />
                  </div>
                </div>
              ) : (
                <div className="flex justify-end">
                  <div className="bg-[#F3F5F9] text-slate-700 text-[12.5px] leading-[1.45] px-3.5 py-2.5 rounded-2xl rounded-tr-md max-w-[84%] whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {sending && (
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-full border border-slate-200 bg-white flex items-center justify-center shrink-0">
              <Brain className="w-3.5 h-3.5 text-blue-600 animate-pulse" strokeWidth={1.6} />
            </div>
            <div className="bg-[#F3F5F9] text-slate-500 text-[12px] px-3.5 py-2.5 rounded-2xl rounded-tl-md">
              Processing PDF with {mode}...
            </div>
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="pt-3 space-y-3">
        {/* Pending attachment / doc context indicator */}
        {(attachedFile || selectedDocForAi) && (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-100 text-[11px] text-blue-800">
            <span className="truncate font-medium">
              Attached: {attachedFile ? attachedFile.name : selectedDocForAi?.fileName}
            </span>
            <button
              type="button"
              onClick={() => {
                setAttachedFile(null);
                onClearSelectedDoc();
              }}
              className="text-blue-600 hover:text-blue-900 shrink-0"
              aria-label="Remove attachment"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-[11px] text-red-700">
            {errorMsg}
          </div>
        )}

        {/* 4 Mode Selector Pills matching mockup */}
        <div className="flex items-center gap-1.5 overflow-x-auto thin-scrollbar pb-0.5">
          {AI_MODES.map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#111827] text-white'
                    : 'bg-[#F3F5F9] text-slate-600 hover:bg-slate-200/70'
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>

        {/* Input Row */}
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.csv,.txt,.docx,.xlsx,application/pdf"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-10 h-10 rounded-full bg-[#F3F5F9] hover:bg-slate-200/70 text-slate-700 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
            aria-label="Upload PDF for AI processing"
            title="Attach PDF for AI processing"
          >
            <Plus className="w-4 h-4" strokeWidth={2} />
          </button>

          <div className="flex-1 h-10 rounded-full bg-[#F3F5F9] px-4 flex items-center gap-2 focus-within:ring-2 focus-within:ring-blue-500/25">
            <input
              ref={inputRef}
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Enter your question..."
              className="w-full bg-transparent text-[12.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleVoicePrompt}
              className="text-slate-600 hover:text-slate-900 shrink-0 cursor-pointer"
              aria-label="Voice input"
            >
              <Mic className="w-4 h-4" strokeWidth={1.8} />
            </button>
            <button
              type="submit"
              disabled={sending}
              className="text-slate-700 hover:text-blue-600 disabled:opacity-40 shrink-0 cursor-pointer"
              aria-label="Send question"
            >
              <Send className="w-4 h-4" strokeWidth={1.8} />
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
};

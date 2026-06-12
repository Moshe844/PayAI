import { Plus, Trash2 } from "lucide-react";

import type { SavedChat } from "../lib/payfixTypes";

type SidebarProps = {
  savedChats: SavedChat[];
  onNewChat: () => void;
  onOpenChat: (chat: SavedChat) => void;
  onDeleteRequest: (chat: SavedChat) => void;
};

export default function Sidebar({
  savedChats,
  onNewChat,
  onOpenChat,
  onDeleteRequest,
}: SidebarProps) {
  return (
    <aside className="flex h-screen flex-col border-l border-slate-200 bg-[#15263a] text-white shadow-xl shadow-slate-950/10">
      <div className="border-b border-white/10 p-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-sm font-black shadow-lg shadow-blue-950/30">
          P
        </div>
        <h1 className="mt-2 text-base font-bold tracking-tight">PayFix AI</h1>
        <p className="mt-0.5 text-xs text-slate-400">Local debugging assistant</p>

        <button
          onClick={onNewChat}
          className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold shadow-lg shadow-blue-950/25 transition hover:-translate-y-0.5 hover:bg-blue-500"
        >
          <Plus size={16} />
          New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-2 px-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
          Saved Chats
        </div>

        <div className="space-y-1">
          {savedChats.map((chat) => (
            <div
              key={chat.id}
              className="group flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-2 transition hover:border-blue-400/40 hover:bg-white/[0.09]"
            >
              <button onClick={() => onOpenChat(chat)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-xs font-semibold">{chat.title}</div>
                <div className="mt-0.5 truncate text-[10px] text-slate-500">{chat.createdAt}</div>
              </button>

              <button
                onClick={() => onDeleteRequest(chat)}
                className="rounded-lg p-1.5 text-slate-500 opacity-80 transition hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"
                title="Delete chat"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        {savedChats.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/10 p-4 text-xs leading-5 text-slate-500">
            Saved conversations will appear here.
          </div>
        )}
      </div>
    </aside>
  );
}

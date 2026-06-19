"use client";

import { useMemo, useState } from "react";
import { MessageSquarePlus, Search, Sparkles, Trash2, X } from "lucide-react";

import type { SavedChat } from "../lib/payfixTypes";

type SidebarProps = {
  savedChats: SavedChat[];
  onNewChat: () => void;
  onOpenChat: (chat: SavedChat) => void;
  onDeleteRequest: (chat: SavedChat) => void;
};

function recoveredChatTitle(chat: SavedChat) {
  if (!/^(new chat|payfix investigation)$/i.test(chat.title.trim())) return chat.title;

  const directUser = chat.messages.find((message) => message.role === "user" && message.content.trim())?.content.trim();
  const agentUser = chat.messages
    .flatMap((message) => message.agentSessionMessages || [])
    .find((message) => message.role === "user" && message.content.trim())?.content.trim();
  const summaryQuestion = chat.messages
    .map((message) => message.content.match(/Investigation question:\s*([\s\S]*?)(?:\n\n|$)/i)?.[1]?.trim())
    .find(Boolean);
  const source = directUser || agentUser || summaryQuestion || chat.title;

  if (source === "Analyze attached context.") return "Attached context analysis";
  return source.replace(/^request:\s*/i, "").slice(0, 60);
}

function chatSearchText(chat: SavedChat) {
  return [
    recoveredChatTitle(chat),
    chat.title,
    chat.createdAt,
    chat.lastActivityAt,
    chat.connectedProjectPath,
    chat.projectPath,
    ...chat.messages.flatMap((message) => [
      message.content,
      ...(message.agentSessionMessages || []).map((agentMessage) => agentMessage.content),
    ]),
  ]
    .filter(Boolean)
    .join("\n");
}

function chatActivityDate(chat: SavedChat) {
  const raw = chat.lastActivityAt || chat.createdAt;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatSessionActivity(chat: SavedChat) {
  const date = chatActivityDate(chat);
  if (date.getTime() === 0) return chat.createdAt || "Unknown time";

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (isSameCalendarDay(date, now)) return `Today, ${time}`;
  if (isSameCalendarDay(date, yesterday)) return `Yesterday, ${time}`;

  return `${date.toLocaleDateString([], { month: "short", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" })}, ${time}`;
}

function matchSnippet(value: string, query: string) {
  if (!query) return "";

  const lowerValue = value.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerValue.indexOf(lowerQuery);
  if (index < 0) return "";

  const start = Math.max(0, index - 28);
  const end = Math.min(value.length, index + query.length + 42);
  return `${start > 0 ? "..." : ""}${value.slice(start, end).replace(/\s+/g, " ").trim()}${end < value.length ? "..." : ""}`;
}

export default function Sidebar({
  savedChats,
  onNewChat,
  onOpenChat,
  onDeleteRequest,
}: SidebarProps) {
  const [searchText, setSearchText] = useState("");
  const visibleChats = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);

    return savedChats
      .map((chat) => {
        const title = recoveredChatTitle(chat);
        const searchable = chatSearchText(chat);
        const searchableLower = searchable.toLowerCase();
        const matches = terms.length === 0 || terms.every((term) => searchableLower.includes(term));
        const snippet = query ? matchSnippet(searchable, query) : "";

        return { chat, title, matches, snippet, activityDate: chatActivityDate(chat) };
      })
      .filter((item) => item.matches)
      .sort((left, right) => right.activityDate.getTime() - left.activityDate.getTime());
  }, [savedChats, searchText]);
  const hasSearch = Boolean(searchText.trim());

  return (
    <aside className="pf-glass flex h-screen min-w-0 flex-col border-r border-[var(--pf-border)] bg-[var(--pf-bg-elevated)]/95">
      <div className="border-b border-[var(--pf-border)] p-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-sm font-black text-white shadow-lg shadow-sky-500/25">
            P
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--pf-bg-elevated)] bg-emerald-400" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold tracking-tight text-[var(--pf-text)]">PayFix AI</h1>
            <p className="truncate text-[11px] font-medium text-[var(--pf-text-faint)]">Local debug console</p>
          </div>
        </div>

        <button
          onClick={onNewChat}
          className="pf-btn-primary mt-4 flex h-10 w-full items-center justify-center gap-2 text-sm"
        >
          <MessageSquarePlus size={16} />
          New investigation
        </button>

        <div className="relative mt-3">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--pf-text-faint)]" />
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search sessions..."
            className="pf-input h-9 py-2 pl-9 pr-8 text-xs"
          />
          {searchText && (
            <button
              type="button"
              onClick={() => setSearchText("")}
              className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-[var(--pf-text-faint)] transition hover:bg-white/5 hover:text-[var(--pf-text)]"
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <span className="pf-section-label">Sessions</span>
          {hasSearch ? (
            <span className="text-[10px] font-bold text-[var(--pf-text-faint)]">
              {visibleChats.length}/{savedChats.length}
            </span>
          ) : savedChats.length > 0 ? (
            <span className="pf-badge">{savedChats.length}</span>
          ) : null}
        </div>

        {hasSearch && (
          <div className="mb-2 rounded-[var(--pf-radius-sm)] border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-[11px] font-semibold text-sky-300">
            {visibleChats.length} match{visibleChats.length === 1 ? "" : "es"} found
          </div>
        )}

        <div className="space-y-1.5">
          {visibleChats.map(({ chat, title, snippet }) => (
            <div
              key={chat.id}
              className="group flex items-center gap-2 rounded-[var(--pf-radius-sm)] border border-transparent bg-white/[0.02] p-2 transition hover:border-[var(--pf-border)] hover:bg-white/[0.05]"
            >
              <button onClick={() => onOpenChat(chat)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <Sparkles size={12} className="shrink-0 text-sky-400/70" />
                  <div className="truncate text-xs font-semibold text-[var(--pf-text)]">{title}</div>
                </div>
                <div className="mt-1 truncate pl-5 text-[10px] font-semibold text-[var(--pf-text-muted)]">{formatSessionActivity(chat)}</div>
                {snippet ? (
                  <div className="mt-1 line-clamp-2 pl-5 text-[10px] leading-4 text-sky-300/80">{snippet}</div>
                ) : null}
              </button>

              <button
                onClick={() => onDeleteRequest(chat)}
                className="rounded-lg p-1.5 text-[var(--pf-text-faint)] opacity-0 transition hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100"
                title="Delete session"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        {savedChats.length === 0 && (
          <div className="rounded-[var(--pf-radius-sm)] border border-dashed border-[var(--pf-border)] bg-white/[0.02] p-5 text-center">
            <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-[var(--pf-text-faint)]">
              <MessageSquarePlus size={16} />
            </div>
            <p className="text-xs leading-5 text-[var(--pf-text-muted)]">Saved investigations appear here after your first chat.</p>
          </div>
        )}

        {savedChats.length > 0 && visibleChats.length === 0 && (
          <div className="rounded-[var(--pf-radius-sm)] border border-dashed border-[var(--pf-border)] p-4 text-xs leading-5 text-[var(--pf-text-muted)]">
            No sessions match this search.
          </div>
        )}
      </div>

      <div className="border-t border-[var(--pf-border)] p-3">
        <div className="flex items-center justify-between gap-2 rounded-[var(--pf-radius-sm)] bg-white/[0.03] px-3 py-2">
          <span className="text-[10px] font-semibold text-[var(--pf-text-faint)]">Local agent</span>
          <span className="pf-badge pf-badge-live">Ready</span>
        </div>
      </div>
    </aside>
  );
}

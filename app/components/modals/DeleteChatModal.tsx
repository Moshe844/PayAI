import type { SavedChat } from "../../lib/payfixTypes";

type DeleteChatModalProps = {
  chat: SavedChat;
  onCancel: () => void;
  onDelete: (id: string) => void;
};

export default function DeleteChatModal({ chat, onCancel, onDelete }: DeleteChatModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-xl font-bold text-slate-900">Delete saved chat?</h3>
        <p className="mt-2 text-sm text-slate-600">
          This will permanently remove this saved conversation.
        </p>
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          {chat.title}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onCancel} className="rounded-xl border border-slate-300 px-5 py-2 font-semibold">
            Cancel
          </button>
          <button
            onClick={() => onDelete(chat.id)}
            className="rounded-xl bg-red-600 px-5 py-2 font-semibold text-white hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

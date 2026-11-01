import Button from '../ui/Button.jsx';

/** The "are you sure?" step shared by every disconnect action. */
export default function RemovalConfirm({ message, busy, onConfirm, onCancel }) {
  return (
    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm text-red-900">{message}</p>
      <div className="mt-3 flex gap-2">
        <Button variant="danger" loading={busy} onClick={onConfirm}>
          Yes, disconnect
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

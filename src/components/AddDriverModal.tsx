// src/components/AddDriverModal.tsx
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import type { DriverStatus } from "../types";

interface AddDriverModalProps {
  onClose: () => void;
  onSave: (driver: {
    name: string;
    callsign: string;
    location: string;
    capacity: number;
    status: DriverStatus;
    phone?: string;
    email?: string;
  }) => Promise<void>;
}

export const AddDriverModal: React.FC<AddDriverModalProps> = ({ onClose, onSave }) => {
  const [formData, setFormData] = useState({
    name: "",
    callsign: "",
    location: "",
    capacity: 20,
    status: "available" as DriverStatus,
    phone: "",
    email: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!formData.name.trim()) {
      setError("Driver name is required");
      return;
    }
    if (!formData.callsign.trim()) {
      setError("Callsign is required");
      return;
    }
    if (!formData.location.trim()) {
      setError("Location is required");
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        ...formData,
        name: formData.name.trim(),
        callsign: formData.callsign.trim(),
        location: formData.location.trim(),
        phone: formData.phone.trim() || undefined,
        email: formData.email.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add driver");
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b p-6">
          <h2 className="text-2xl font-bold text-gray-900">Add New Transporter</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-gray-100"
            disabled={isSaving}
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Driver Name <span className="text-red-500">*</span>
            </label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., John Smith"
              disabled={isSaving}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Callsign <span className="text-red-500">*</span>
            </label>
            <Input
              value={formData.callsign}
              onChange={(e) => setFormData({ ...formData, callsign: e.target.value })}
              placeholder="e.g., DR-001"
              disabled={isSaving}
              required
            />
            <p className="mt-1 text-xs text-gray-500">Unique identifier for the driver</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Location <span className="text-red-500">*</span>
            </label>
            <Input
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              placeholder="e.g., K58 Warehouse"
              disabled={isSaving}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Capacity (Pallets)
            </label>
            <Input
              type="number"
              value={formData.capacity}
              onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) || 0 })}
              min="1"
              disabled={isSaving}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Status
            </label>
            <Select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as DriverStatus })}
              disabled={isSaving}
            >
              <option value="available">Available</option>
              <option value="busy">Busy</option>
              <option value="offline">Offline</option>
              <option value="break">On Break</option>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Phone (Optional)
            </label>
            <Input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="e.g., +1234567890"
              disabled={isSaving}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Email (Optional)
            </label>
            <Input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="e.g., driver@example.com"
              disabled={isSaving}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSaving}
              className="flex-1"
            >
              {isSaving ? "Adding..." : "Add Transporter"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

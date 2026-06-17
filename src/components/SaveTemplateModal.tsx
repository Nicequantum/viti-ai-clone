'use client';

import { useEffect, useState } from 'react';
import { BookmarkPlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { TemplateCategory } from '@/types';

interface SaveTemplateModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (title: string, savedText: string) => void;
  defaultTitle: string;
  defaultCategory: TemplateCategory;
  storyText: string;
  generatedText: string;
  lineDescription: string;
  vehicleMake?: string;
  vehicleModel?: string;
  codes?: string[];
  repairOrderId?: string;
  lineId?: string;
}

export function SaveTemplateModal({
  open,
  onClose,
  onSaved,
  defaultTitle,
  defaultCategory,
  storyText,
  generatedText,
  lineDescription,
  vehicleMake,
  vehicleModel,
  codes,
  repairOrderId,
  lineId,
}: SaveTemplateModalProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [category, setCategory] = useState<TemplateCategory>(defaultCategory);
  const [preview, setPreview] = useState(storyText);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setCategory(defaultCategory);
    setPreview(storyText);
  }, [open, defaultTitle, defaultCategory, storyText]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, saving, onClose]);

  const handleSave = async () => {
    const trimmedTitle = title.trim();
    const trimmedPreview = preview.trim();
    if (!trimmedTitle) {
      toast.error('Enter a template title');
      return;
    }
    if (!trimmedPreview) {
      toast.error('Story text cannot be empty');
      return;
    }

    setSaving(true);
    try {
      await api.saveTemplateFromStory({
        title: trimmedTitle,
        category,
        finalText: trimmedPreview,
        generatedText,
        lineDescription,
        vehicleMake,
        vehicleModel,
        codes,
        repairOrderId,
        lineId,
      });
      toast.success(`Template "${trimmedTitle}" saved — Grok will learn from this story`);
      onSaved(trimmedTitle, trimmedPreview);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="ios-card w-full sm:max-w-xl max-h-[92dvh] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden border border-[#38383a]">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-[#38383a]">
          <div>
            <div className="flex items-center gap-2 text-[#30d158] mb-1">
              <BookmarkPlus size={18} />
              <span className="text-xs uppercase tracking-[0.2em] font-semibold">Save as New Template</span>
            </div>
            <h2 className="text-lg font-semibold">Grow the Knowledge Base</h2>
            <p className="text-xs text-[#8e8e93] mt-1">
              Your approved story trains future Grok generations for this dealership.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-2 rounded-xl border border-[#38383a] text-[#8e8e93] hover:text-white disabled:opacity-50"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-[#8e8e93] block mb-1.5">Template Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={saving}
              placeholder="e.g. Blind Spot Assist — S-Class Software Update"
              className="w-full bg-[#1c1c1e] border border-[#38383a] rounded-xl px-3 py-2.5 text-sm disabled:opacity-60"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-widest text-[#8e8e93] block mb-1.5">Category</label>
            <div className="flex gap-2">
              {(['warranty', 'customer'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={saving}
                  onClick={() => setCategory(value)}
                  className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-medium border transition-colors disabled:opacity-60 ${
                    category === value
                      ? 'bg-[#0a84ff]/15 border-[#0a84ff]/50 text-white'
                      : 'bg-[#1c1c1e] border-[#38383a] text-[#8e8e93]'
                  }`}
                >
                  {value === 'customer' ? 'Customer Pay' : 'Warranty Claims'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-widest text-[#8e8e93] block mb-1.5">
              Story Preview (final edits)
            </label>
            <textarea
              value={preview}
              onChange={(e) => setPreview(e.target.value)}
              disabled={saving}
              rows={12}
              className="w-full bg-[#1c1c1e] border border-[#38383a] rounded-xl px-3 py-3 text-sm leading-relaxed resize-y disabled:opacity-60"
            />
            <p className="text-[10px] text-[#8e8e93] mt-1">
              Grok draft is stored separately so the system learns what you changed.
            </p>
          </div>
        </div>

        <div className="p-5 border-t border-[#38383a] flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="primary-btn flex-1 h-12 text-sm flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                SAVING TEMPLATE…
              </>
            ) : (
              'SAVE TO LIBRARY'
            )}
          </button>
          <button type="button" onClick={onClose} disabled={saving} className="secondary-btn h-12 px-4 text-sm disabled:opacity-60">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
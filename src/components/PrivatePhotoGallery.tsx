import React, { useEffect, useState } from 'react';
import { Camera, Eye, Trash2, Upload, X } from 'lucide-react';
import { apiFetch, fetchAuthBlobUrl, formatDatePT } from '../lib/api';
import type { OrderPhoto, PhotoPhase } from '../types/domain';

const PHASE_LABELS: Record<PhotoPhase, string> = {
  before: 'Antes',
  during: 'Durante',
  after: 'Depois',
  invoice: 'Fatura / Peça',
};

async function fileToOptimizedDataUrl(file: File): Promise<string> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Erro ao ler imagem.'));
    reader.readAsDataURL(file);
  });

  if (file.size <= 900 * 1024 && (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp')) {
    return rawDataUrl;
  }

  return await new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1600;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(rawDataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

export function PrivatePhotoGallery({
  orderId,
  photos,
  canUpload,
  canDeleteAny,
  currentUserId,
  onChanged,
}: {
  orderId: string;
  photos: OrderPhoto[];
  canUpload: boolean;
  canDeleteAny: boolean;
  currentUserId: string;
  onChanged: () => Promise<void> | void;
}) {
  const [blobMap, setBlobMap] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<PhotoPhase>('before');
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<OrderPhoto | null>(null);

  useEffect(() => {
    let cancelled = false;
    const createdUrls: string[] = [];

    async function loadImages() {
      const next: Record<string, string> = {};
      await Promise.all(
        photos.map(async (p) => {
          try {
            const url = await fetchAuthBlobUrl(`/api/orders/${orderId}/photos/${p.id}/file`);
            if (cancelled) {
              URL.revokeObjectURL(url);
            } else {
              createdUrls.push(url);
              next[p.id] = url;
            }
          } catch {
            // ignore inaccessible thumbnail
          }
        })
      );
      if (!cancelled) {
        setBlobMap(next);
      }
    }

    if (photos.length > 0) {
      loadImages();
    } else {
      setBlobMap({});
    }

    return () => {
      cancelled = true;
      createdUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [orderId, photos]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const dataUrl = await fileToOptimizedDataUrl(file);
      await apiFetch(`/api/orders/${orderId}/photos`, {
        method: 'POST',
        body: JSON.stringify({
          phase,
          caption,
          fileName: file.name,
          dataUrl,
        }),
      });
      setCaption('');
      await onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(photoId: string) {
    setError(null);
    try {
      await apiFetch(`/api/orders/${orderId}/photos/${photoId}`, { method: 'DELETE' });
      if (lightboxPhoto?.id === photoId) setLightboxPhoto(null);
      await onChanged();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-slate-600" />
          <h3 className="text-base font-semibold text-slate-900">
            Fotos Privadas da Intervenção ({photos.length})
          </h3>
        </div>
        <span className="text-xs text-slate-500">Armazenamento privado autenticado</span>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {canUpload && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <select
            value={phase}
            onChange={(e) => setPhase(e.target.value as PhotoPhase)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700"
          >
            <option value="before">Fase: Antes</option>
            <option value="during">Fase: Durante</option>
            <option value="after">Fase: Depois</option>
            <option value="invoice">Fase: Fatura / Peça</option>
          </select>

          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Legenda opcional (ex: Válvula substituída)"
            className="flex-1 min-w-[180px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
          />

          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap">
            <Upload className="h-3.5 w-3.5" />
            <span>{uploading ? 'A enviar...' : 'Carregar Foto'}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
        </div>
      )}

      {photos.length === 0 ? (
        <p className="text-xs text-slate-500">
          Ainda não existem fotografias anexadas a esta ordem de serviço.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((p) => {
            const imgSrc = blobMap[p.id];
            const canDel = canDeleteAny || p.uploaded_by === currentUserId;
            return (
              <div
                key={p.id}
                className="overflow-hidden rounded-lg border border-slate-200 bg-white flex flex-col"
              >
                <div className="relative h-36 bg-slate-100 flex items-center justify-center">
                  {imgSrc ? (
                    <img
                      src={imgSrc}
                      alt={p.caption || p.file_name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-[11px] text-slate-400">A carregar imagem...</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setLightboxPhoto(p)}
                    className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-900/75 text-white hover:bg-slate-900"
                    aria-label="Ampliar foto"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex flex-1 flex-col justify-between p-3 text-xs">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        {PHASE_LABELS[p.phase] || p.phase}
                      </span>
                      <span className="text-[11px] text-slate-400 tabular-nums">
                        {formatDatePT(p.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-600 line-clamp-2">
                      {p.caption || p.file_name}
                    </p>
                  </div>

                  <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                    <span className="truncate">{p.uploader_name || 'Equipa'}</span>
                    {canDel && (
                      <button
                        type="button"
                        onClick={() => handleDelete(p.id)}
                        className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-700"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Remover</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxPhoto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4">
          <div className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-xl border border-slate-700 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div className="text-xs">
                <span className="font-semibold text-slate-900">
                  {PHASE_LABELS[lightboxPhoto.phase]}
                </span>
                {lightboxPhoto.caption && (
                  <span className="ml-2 text-slate-600">· {lightboxPhoto.caption}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setLightboxPhoto(null)}
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Fechar visualização"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex max-h-[75vh] items-center justify-center bg-slate-950 p-4">
              {blobMap[lightboxPhoto.id] ? (
                <img
                  src={blobMap[lightboxPhoto.id]}
                  alt={lightboxPhoto.caption || lightboxPhoto.file_name}
                  className="max-h-[70vh] w-auto object-contain"
                />
              ) : (
                <span className="text-xs text-slate-400">A carregar...</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

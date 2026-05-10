import React, { useState, useEffect, useCallback } from 'react';
import { 
  Upload, 
  Save, 
  Trash2, 
  Film, 
  Link as LinkIcon,
  Play,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { cn } from './lib/utils';
import { apiUrl } from './lib/api';

interface VideoConfig {
  id: string;
  label: string;
  group: string;
  description?: string;
  action_trigger?: string;
  loop?: boolean;
  next_video_id?: string;
}

interface PersonaConfig {
  videos: VideoConfig[];
  action_map: Record<string, string[]>;
  transitions: Record<string, { safe_next: string[] }>;
  triggers?: {
    gift_keywords: string[];
    message_keywords: string[];
  };
  gift_map?: Record<string, string[]>;
}

interface PersonaMediaLibraryProps {
  onClose: () => void;
  onConfigChange?: () => void;
}

export default function PersonaMediaLibrary({ onClose, onConfigChange }: PersonaMediaLibraryProps) {
  const [config, setConfig] = useState<PersonaConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'videos' | 'actions' | 'triggers' | 'upload'>('videos');
  const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error' | 'none', message: string }>({ type: 'none', message: '' });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState(false);
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);
  const [newGiftName, setNewGiftName] = useState('');
  const [newGiftSelected, setNewGiftSelected] = useState<string[]>([]);
  const [editingGiftKey, setEditingGiftKey] = useState<string | null>(null);
  const [editingGiftSelected, setEditingGiftSelected] = useState<string[]>([]);

  const addGiftMapping = () => {
    if (!config) return;
    const key = newGiftName.trim();
    if (!key) return;
    const gm = { ...(config.gift_map || {}) } as Record<string, string[]>;
    gm[key] = Array.from(newGiftSelected);
    setConfig({ ...config, gift_map: gm });
    setNewGiftName('');
    setNewGiftSelected([]);
  };

  const startEditGift = (key: string) => {
    if (!config || !config.gift_map) return;
    setEditingGiftKey(key);
    setEditingGiftSelected(Array.from(config.gift_map[key] || []));
  };

  const saveEditedGift = () => {
    if (!config || !editingGiftKey) return;
    const gm = { ...(config.gift_map || {}) } as Record<string, string[]>;
    gm[editingGiftKey] = Array.from(editingGiftSelected);
    setConfig({ ...config, gift_map: gm });
    setEditingGiftKey(null);
    setEditingGiftSelected([]);
  };

  const deleteGiftMapping = (key: string) => {
    if (!config || !config.gift_map) return;
    const gm = { ...(config.gift_map || {}) } as Record<string, string[]>;
    delete gm[key];
    setConfig({ ...config, gift_map: gm });
  };

  const toggleVideoSelectionForNew = (id: string) => {
    setNewGiftSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleVideoSelectionForEdit = (id: string) => {
    setEditingGiftSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/video/config'));
      const data = await res.json();
      setConfig(data);
    } catch (err) {
      console.error('Failed to fetch config', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      fetchConfig();
    }, 0);
    return () => clearTimeout(t);
  }, [fetchConfig]);

  const handleSave = async () => {
    if (!config) return;
    
    // Synchronize action_map with video triggers
    const newActionMap: Record<string, string[]> = {
      gift: [],
      message: [],
      idle: []
    };
    
    config.videos.forEach(v => {
      if (v.action_trigger && v.action_trigger !== 'none' && newActionMap[v.action_trigger]) {
        newActionMap[v.action_trigger].push(v.id);
      }
    });

    const configToSave = {
      ...config,
      action_map: newActionMap
    };

    setIsSaving(true);
    try {
      const res = await fetch(apiUrl('/api/video/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configToSave),
      });
      if (res.ok) {
        onConfigChange?.();
        setUploadStatus({ type: 'success', message: 'Configuração salva com sucesso!' });
        setTimeout(() => setUploadStatus({ type: 'none', message: '' }), 3000);
      }
    } catch {
      setUploadStatus({ type: 'error', message: 'Erro ao salvar configuração' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este vídeo?')) return;
    
    try {
      const res = await fetch(apiUrl(`/api/video/${id}`), {
        method: 'DELETE',
      });
      if (res.ok) {
        setUploadStatus({ type: 'success', message: 'Vídeo removido com sucesso!' });
        fetchConfig();
        onConfigChange?.();
      }
    } catch {
      setUploadStatus({ type: 'error', message: 'Erro ao excluir vídeo' });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Tem certeza que deseja excluir ${selectedIds.length} vídeos?`)) return;

    setIsSaving(true);
    try {
      for (const id of selectedIds) {
        await fetch(apiUrl(`/api/video/${id}`), { method: 'DELETE' });
      }
      setUploadStatus({ type: 'success', message: `${selectedIds.length} vídeos removidos!` });
      setSelectedIds([]);
      fetchConfig();
      onConfigChange?.();
    } catch {
      setUploadStatus({ type: 'error', message: 'Erro ao excluir alguns vídeos' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatus({ type: 'none', message: `Preparando upload de ${files.length} arquivo(s)...` });

    let successCount = 0;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const formData = new FormData();
      formData.append('file', file);

      try {
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', apiUrl('/api/video/upload'));
          
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const fileProgress = (event.loaded / event.total) * 100;
              const totalProgress = ((i / files.length) * 100) + (fileProgress / files.length);
              setUploadProgress(Math.round(totalProgress));
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              successCount++;
              resolve(JSON.parse(xhr.response));
            } else {
              reject(new Error('Upload failed'));
            }
          };
          
          xhr.onerror = () => reject(new Error('Network error'));
          xhr.send(formData);
        });
      } catch (err) {
        console.error(`Failed to upload ${file.name}`, err);
      }
    }

    setIsUploading(false);
    setUploadProgress(100);
    setUploadStatus({ 
      type: successCount === files.length ? 'success' : 'error', 
      message: `Upload concluído: ${successCount}/${files.length} arquivos enviados.` 
    });
    
    fetchConfig();
    onConfigChange?.();
    e.target.value = '';
  };

  const updateVideo = (id: string, patch: Partial<VideoConfig>) => {
    if (!config) return;
    setConfig({
      ...config,
      videos: config.videos.map(v => v.id === id ? { ...v, ...patch } : v)
    });
  };

  const updateTransitions = (id: string, safeNext: string[]) => {
    if (!config) return;
    setConfig({
      ...config,
      transitions: {
        ...config.transitions,
        [id]: { safe_next: safeNext }
      }
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div 
      onClick={(e) => e.stopPropagation()}
      className="flex flex-col h-full bg-slate-900 text-white rounded-2xl border border-slate-800 shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Film className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-bold">Biblioteca de Persona</h2>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-bold transition disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Salvar
          </button>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex p-1 bg-slate-950/50 border-b border-slate-800">
        <button 
          onClick={() => setActiveTab('videos')}
          className={cn(
            "flex-1 py-2 text-xs font-bold rounded-md transition",
            activeTab === 'videos' ? "bg-slate-800 text-blue-400" : "text-slate-500 hover:text-slate-300"
          )}
        >
          Vídeos
        </button>
        <button 
          onClick={() => setActiveTab('actions')}
          className={cn(
            "flex-1 py-2 text-xs font-bold rounded-md transition",
            activeTab === 'actions' ? "bg-slate-800 text-blue-400" : "text-slate-500 hover:text-slate-300"
          )}
        >
          Ações
        </button>
        <button 
          onClick={() => setActiveTab('triggers')}
          className={cn(
            "flex-1 py-2 text-xs font-bold rounded-md transition",
            activeTab === 'triggers' ? "bg-slate-800 text-blue-400" : "text-slate-500 hover:text-slate-300"
          )}
        >
          Gatilhos
        </button>
        <button 
          onClick={() => setActiveTab('upload')}
          className={cn(
            "flex-1 py-2 text-xs font-bold rounded-md transition",
            activeTab === 'upload' ? "bg-slate-800 text-blue-400" : "text-slate-500 hover:text-slate-300"
          )}
        >
          Upload
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {uploadStatus.type !== 'none' && (
          <div className={cn(
            "mb-4 p-3 rounded-lg flex items-center gap-2 text-xs font-medium animate-in fade-in slide-in-from-top-2",
            uploadStatus.type === 'success' ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
          )}>
            {uploadStatus.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {uploadStatus.message}
          </div>
        )}

        {activeTab === 'videos' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-[10px] text-slate-500 cursor-pointer hover:text-slate-300 transition">
                  <input 
                    type="checkbox"
                    checked={(config?.videos?.length ?? 0) > 0 && selectedIds.length === (config?.videos?.length || 0)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(config?.videos.map(v => v.id) || []);
                      } else {
                        setSelectedIds([]);
                      }
                    }}
                    className="w-3 h-3 rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-0"
                  />
                  Selecionar Tudo
                </label>
                {selectedIds.length > 0 && (
                  <span className="text-[10px] text-blue-400 font-bold">{selectedIds.length} selecionados</span>
                )}
              </div>
              {selectedIds.length > 0 && (
                <button 
                  onClick={handleBulkDelete}
                  className="flex items-center gap-1.5 px-2 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 rounded text-[10px] font-bold transition"
                >
                  <Trash2 className="w-3 h-3" />
                  Excluir Selecionados
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4">
              {config?.videos.map((video) => (
                <div 
                  key={video.id} 
                  className={cn(
                    "group p-4 bg-slate-800/40 rounded-xl border transition",
                    selectedIds.includes(video.id) ? "border-blue-500/50 bg-blue-500/5 shadow-[0_0_15px_rgba(59,130,246,0.1)]" : "border-slate-700/50 hover:border-slate-600"
                  )}
                >
                  <div className="flex gap-4">
                    <div className="relative shrink-0">
                      <input 
                        type="checkbox"
                        checked={selectedIds.includes(video.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds([...selectedIds, video.id]);
                          } else {
                            setSelectedIds(selectedIds.filter(id => id !== video.id));
                          }
                        }}
                        className="absolute -top-1 -left-1 z-10 w-4 h-4 rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-0 opacity-0 group-hover:opacity-100 checked:opacity-100 transition"
                      />
                      <div 
                        className="w-32 h-20 rounded-lg bg-black overflow-hidden relative border border-slate-700 cursor-zoom-in group/thumb"
                        onClick={() => setPreviewVideoId(video.id)}
                      >
                        <video 
                          src={apiUrl(`/api/video/play/${video.id}`)}
                          className="w-full h-full object-cover opacity-60 group-hover/thumb:opacity-100 transition"
                          muted
                          onMouseOver={e => (e.target as HTMLVideoElement).play()}
                          onMouseOut={e => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0; }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition bg-black/40">
                          <Play className="w-6 h-6 text-white drop-shadow-lg" />
                        </div>
                        <div className="absolute top-1 left-1 bg-black/60 px-1 rounded text-[8px] font-mono">
                          ID:{video.id}
                        </div>
                      </div>
                    </div>
                  
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <input 
                          type="text"
                          value={video.label}
                          onChange={(e) => updateVideo(video.id, { label: e.target.value })}
                          placeholder="Nome do vídeo..."
                          className="flex-1 bg-transparent border-none p-0 text-sm font-bold focus:ring-0 placeholder:text-slate-600"
                        />
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => setPreviewVideoId(video.id)}
                            className="p-1.5 text-slate-600 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition"
                            title="Ver prévia"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => handleDelete(video.id)}
                            className="p-1.5 text-slate-600 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition"
                            title="Remover vídeo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <select 
                          value={video.group}
                          onChange={(e) => updateVideo(video.id, { group: e.target.value })}
                          className="bg-slate-900 border-slate-700 text-[10px] rounded px-2 py-1 outline-none focus:border-blue-500/50 transition"
                        >
                          <option value="base_idle">Idle Base</option>
                          <option value="look_side">Olhar Lateral</option>
                          <option value="hair_motion">Cabelo</option>
                          <option value="thank_you">Agradecimento</option>
                          <option value="read_screen">Leitura</option>
                        </select>

                        <select 
                          value={video.action_trigger || 'none'}
                          onChange={(e) => updateVideo(video.id, { action_trigger: e.target.value })}
                          className="bg-slate-900 border-slate-700 text-[10px] rounded px-2 py-1 outline-none text-blue-400 focus:border-blue-500/50 transition"
                        >
                          <option value="none">Sem Ação</option>
                          <option value="gift">Gifts</option>
                          <option value="message">Mensagem</option>
                          <option value="idle">Loop Idle</option>
                        </select>

                        <div className="flex items-center gap-1 ml-2">
                          <input 
                            type="checkbox"
                            checked={video.loop || false}
                            onChange={(e) => updateVideo(video.id, { loop: e.target.checked })}
                            className="w-3 h-3 rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-0"
                            id={`loop-${video.id}`}
                          />
                          <label htmlFor={`loop-${video.id}`} className="text-[10px] text-slate-500 cursor-pointer">Loop</label>
                        </div>
                      </div>

                      <div className="mt-2 pt-2 border-t border-slate-700/30">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Recomendar Transição para:</span>
                          <span className="text-[8px] text-slate-600 font-mono">{config.transitions?.[video.id]?.safe_next?.length || 0} vinculados</span>
                        </div>
                        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar pr-1 py-1">
                          {config?.videos.map(v => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => {
                                const currentSafe = config.transitions?.[video.id]?.safe_next || [];
                                const newSafe = currentSafe.includes(v.id) 
                                  ? currentSafe.filter(sid => sid !== v.id)
                                  : [...currentSafe, v.id];
                                updateTransitions(video.id, newSafe);
                              }}
                              className={cn(
                                "px-2 py-0.5 rounded text-[8px] font-bold transition border",
                                (config.transitions?.[video.id]?.safe_next || []).includes(v.id)
                                  ? "bg-blue-600/30 text-blue-300 border-blue-500/50 shadow-[0_0_8px_rgba(59,130,246,0.15)]"
                                  : "bg-slate-900/50 text-slate-500 border-slate-800 hover:border-slate-700"
                              )}
                            >
                              {v.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'actions' && (
          <div className="space-y-6">
            {['idle', 'gift', 'message'].map((action) => (
              <div key={action} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <LinkIcon className="w-3 h-3" />
                    Ação: {action === 'idle' ? 'Loop de Repouso' : action === 'gift' ? 'Reação a Gifts' : 'Reação a Chat'}
                  </h3>
                </div>
                <div className="p-4 bg-slate-950/30 rounded-xl border border-slate-800 flex flex-wrap gap-2">
                  {config?.videos
                    .filter(v => v.action_trigger === action)
                    .map(v => (
                      <span key={v.id} className="px-2 py-1 bg-blue-500/10 text-blue-400 rounded-md text-[10px] font-bold border border-blue-500/20">
                        {v.label} ({v.id})
                      </span>
                    ))}
                  {config?.videos.filter(v => v.action_trigger === action).length === 0 && (
                    <span className="text-[10px] text-slate-600 italic">Nenhum vídeo vinculado</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'triggers' && (
          <div className="space-y-6">
            <div className="p-4 bg-blue-500/5 rounded-xl border border-blue-500/20 text-xs text-blue-300 leading-relaxed">
              <p>Configure aqui as palavras que o <strong>OCR</strong> irá capturar no chat para acionar automaticamente as reações da persona.</p>
            </div>

            <div className="space-y-4">
              {/* Gift Keywords */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Gatilhos para Gifts (Presentes)</label>
                <div className="p-4 bg-slate-950/30 rounded-xl border border-slate-800 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {config?.triggers?.gift_keywords.map((kw, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 px-2 py-1 bg-rose-500/10 text-rose-400 rounded border border-rose-500/20 text-[10px] font-bold">
                        {kw}
                        <button 
                          onClick={() => {
                            if (!config) return;
                            const newKws = [...(config.triggers?.gift_keywords || [])];
                            newKws.splice(idx, 1);
                            setConfig({ ...config, triggers: { ...config.triggers!, gift_keywords: newKws } });
                          }}
                          className="hover:text-rose-300"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      placeholder="Adicionar palavra (ex: presente)..."
                      className="flex-1 bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-xs outline-none focus:border-rose-500/50"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = e.currentTarget.value.trim();
                          if (val && config) {
                            const newKws = [...(config.triggers?.gift_keywords || []), val];
                            setConfig({ ...config, triggers: { ...config.triggers!, gift_keywords: newKws } });
                            e.currentTarget.value = '';
                          }
                        }
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Message Keywords */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Gatilhos para Chat (Ações)</label>
                <div className="p-4 bg-slate-950/30 rounded-xl border border-slate-800 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {config?.triggers?.message_keywords.map((kw, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 px-2 py-1 bg-blue-500/10 text-blue-400 rounded border border-blue-500/20 text-[10px] font-bold">
                        {kw}
                        <button 
                          onClick={() => {
                            if (!config) return;
                            const newKws = [...(config.triggers?.message_keywords || [])];
                            newKws.splice(idx, 1);
                            setConfig({ ...config, triggers: { ...config.triggers!, message_keywords: newKws } });
                          }}
                          className="hover:text-blue-300"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      placeholder="Adicionar palavra (ex: oi, linda)..."
                      className="flex-1 bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-xs outline-none focus:border-blue-500/50"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = e.currentTarget.value.trim();
                          if (val && config) {
                            const newKws = [...(config.triggers?.message_keywords || []), val];
                            setConfig({ ...config, triggers: { ...config.triggers!, message_keywords: newKws } });
                            e.currentTarget.value = '';
                          }
                        }
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Gift -> Video Mapping */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Mapeamento de Gifts → Vídeos</label>
                <div className="p-4 bg-slate-950/30 rounded-xl border border-slate-800 space-y-3">
                  <div className="flex flex-col gap-2">
                    {(config?.gift_map && Object.keys(config.gift_map).length > 0) ? (
                      Object.keys(config!.gift_map!).map((key) => (
                        <div key={key} className="flex items-center justify-between bg-slate-900/50 rounded px-3 py-2">
                          <div className="flex items-center gap-3">
                            <strong className="text-[11px] text-rose-300">{key}</strong>
                            <div className="flex gap-1 flex-wrap">
                              {(config!.gift_map![key] || []).map(vId => (
                                <span key={vId} className="text-[10px] bg-blue-500/10 text-blue-300 px-2 py-0.5 rounded border border-blue-500/20">{config?.videos.find(v => v.id === vId)?.label || vId}</span>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {editingGiftKey === key ? (
                              <>
                                <button onClick={saveEditedGift} className="px-2 py-1 bg-emerald-600/20 text-emerald-300 rounded text-[10px]">Salvar</button>
                                <button onClick={() => setEditingGiftKey(null)} className="px-2 py-1 bg-slate-800/60 text-slate-300 rounded text-[10px]">Cancelar</button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => startEditGift(key)} className="px-2 py-1 bg-blue-600/20 text-blue-300 rounded text-[10px]">Editar</button>
                                <button onClick={() => deleteGiftMapping(key)} className="px-2 py-1 bg-rose-600/20 text-rose-300 rounded text-[10px]">Remover</button>
                              </>
                            )}
                          </div>

                          {/* Edit mode inline */}
                          {editingGiftKey === key && (
                            <div className="w-full mt-2 grid grid-cols-3 gap-2">
                              {config?.videos.map(v => (
                                <label key={v.id} className="flex items-center gap-2 text-[10px]">
                                  <input type="checkbox" checked={editingGiftSelected.includes(v.id)} onChange={() => toggleVideoSelectionForEdit(v.id)} />
                                  <span className="truncate">{v.label}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-[10px] text-slate-600 italic">Nenhum mapeamento de gifts configurado.</div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-800/40">
                    <div className="flex gap-2 items-center">
                      <input value={newGiftName} onChange={(e) => setNewGiftName(e.target.value)} placeholder="Nome do presente (ex: Rosa)" className="flex-1 bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-xs outline-none" />
                      <button onClick={addGiftMapping} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs">Adicionar mapeamento</button>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-2 max-h-40 overflow-y-auto pr-1">
                      {config?.videos.map(v => (
                        <button key={v.id} type="button" onClick={() => toggleVideoSelectionForNew(v.id)} className={cn("text-[10px] px-2 py-1 rounded border", newGiftSelected.includes(v.id) ? "bg-blue-600/30 text-blue-300 border-blue-500/40" : "bg-slate-900/40 text-slate-400 border-slate-800")}>{v.label}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'upload' && (
          <div className="h-full flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-950/20">
            {isUploading ? (
              <div className="w-full max-w-md space-y-4 text-center">
                <div className="relative h-12 w-12 mx-auto mb-4">
                  <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
                    {uploadProgress}%
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 transition-all duration-300" 
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-400">{uploadStatus.message}</p>
                </div>
              </div>
            ) : (
              <>
                <Upload className="w-12 h-12 text-slate-700 mb-4" />
                <p className="text-sm font-medium text-slate-400 mb-1">Arraste ou clique para upload</p>
                <p className="text-[10px] text-slate-600 mb-6">Formatos aceitos: MP4 (múltiplos permitidos)</p>
                <input 
                  type="file"
                  accept="video/mp4"
                  multiple
                  onChange={handleUpload}
                  className="hidden"
                  id="video-upload"
                />
                <label 
                  htmlFor="video-upload"
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-full text-xs font-bold transition cursor-pointer"
                >
                  Selecionar Arquivos
                </label>
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 bg-slate-950/50 border-t border-slate-800 flex items-center justify-between">
        <p className="text-[10px] text-slate-500 font-mono">
          ODESSA_MEDIA_CORE_V1.0
        </p>
        <div className="flex items-center gap-4 text-[10px] text-slate-500">
          <span>{config?.videos.length || 0} vídeos</span>
          <div className="w-1 h-1 bg-slate-700 rounded-full" />
          <span>{Object.keys(config?.action_map || {}).length} ações</span>
        </div>
      </div>

      {/* Preview Modal */}
      {previewVideoId && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-black/90 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setPreviewVideoId(null)}
        >
          <div 
            className="relative w-full max-w-4xl aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/10"
            onClick={e => e.stopPropagation()}
          >
            <video 
              src={apiUrl(`/api/video/play/${previewVideoId}`)}
              className="w-full h-full object-contain"
              controls
              autoPlay
            />
            <div className="absolute top-4 left-4 bg-black/60 px-3 py-1.5 rounded-full backdrop-blur-md border border-white/10 flex items-center gap-2">
              <Film className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-bold">{config?.videos.find(v => v.id === previewVideoId)?.label} ({previewVideoId})</span>
            </div>
            <button 
              onClick={() => setPreviewVideoId(null)}
              className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-black/80 rounded-full backdrop-blur-md border border-white/10 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

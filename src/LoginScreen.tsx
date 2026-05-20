import { useState } from 'react';
import { apiUrl } from './lib/api';

type LoginScreenProps = {
  onLogin: () => void;
};

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(apiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        authenticated?: boolean;
        sessionToken?: string;
        detail?: string;
      };
      if (!response.ok || !data.authenticated) {
        setError(data.detail || 'Email ou senha incorretos.');
        return;
      }
      if (data.sessionToken) {
        try {
          window.sessionStorage.setItem('odessa:admin-session-token:v1', data.sessionToken);
        } catch {}
      }
      onLogin();
    } catch {
      setError('Erro de conexao. Verifique sua internet.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg, #0a0a0f)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: 380,
          padding: 32,
          borderRadius: 12,
          background: 'var(--surface, #15151e)',
          border: '1px solid var(--border, #2a2a3a)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--t1, #f0f0f5)',
              margin: '0 0 6px',
              letterSpacing: '-0.02em',
            }}
          >
            Odessa
          </h1>
          <p style={{ fontSize: 13, color: 'var(--t3, #888)', margin: 0 }}>
            Entre com suas credenciais para acessar o painel
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.25)',
              color: '#f87171',
              fontSize: 13,
              marginBottom: 18,
            }}
          >
            {error}
          </div>
        )}

        <label style={{ display: 'block', marginBottom: 14 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--t2, #aaa)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Email
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
            placeholder="seu@email.com"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 6,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border, #2a2a3a)',
              background: 'var(--bg, #0a0a0f)',
              color: 'var(--t1, #f0f0f5)',
              fontSize: 14,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 22 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--t2, #aaa)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Senha
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="••••••••"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 6,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border, #2a2a3a)',
              background: 'var(--bg, #0a0a0f)',
              color: 'var(--t1, #f0f0f5)',
              fontSize: 14,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '11px 0',
            borderRadius: 8,
            border: 'none',
            background: loading ? '#444' : 'var(--accent, #6366f1)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

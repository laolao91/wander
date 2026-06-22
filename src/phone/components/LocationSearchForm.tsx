import { useState, useEffect, useRef } from 'react'
import { Loading } from 'even-toolkit/web'
import type { ManualLocation } from '../types'
import { searchLocations } from '../lib/geocoding'

export { searchLocations }

// ─── Component ────────────────────────────────────────────────────────────

export interface LocationSearchFormProps {
  onSelect: (location: ManualLocation) => void
  onCancel?: () => void
}

type SearchMode = 'search' | 'address'
type SearchStatus = 'idle' | 'loading' | 'error'

export function LocationSearchForm({ onSelect, onCancel }: LocationSearchFormProps) {
  const [mode, setMode] = useState<SearchMode>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ManualLocation[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (mode !== 'search') return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) {
      setResults([])
      setStatus('idle')
      setErrorMsg(null)
      return
    }
    debounceRef.current = setTimeout(() => {
      setStatus('loading')
      setErrorMsg(null)
      searchLocations(query.trim())
        .then((r) => {
          if (!mountedRef.current) return
          setResults(r)
          setStatus('idle')
        })
        .catch(() => {
          if (!mountedRef.current) return
          setStatus('error')
          setErrorMsg("Couldn't search right now — check your connection.")
        })
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, mode])

  function handleAddressSubmit() {
    if (!query.trim()) return
    setStatus('loading')
    setErrorMsg(null)
    searchLocations(query.trim())
      .then((r) => {
        if (!mountedRef.current) return
        if (r.length === 0) {
          setStatus('error')
          setErrorMsg('Address not found. Try rewording it or go back to search.')
        } else {
          onSelect(r[0])
        }
      })
      .catch(() => {
        if (!mountedRef.current) return
        setStatus('error')
        setErrorMsg("Couldn't search right now — check your connection.")
      })
  }

  if (mode === 'address') {
    return (
      <div>
        <div className="mb-1 text-[11px] font-semibold text-text-dim uppercase tracking-wide">
          Exact address
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddressSubmit()}
          placeholder="1600 Pennsylvania Ave NW, Washington DC"
          autoFocus
          className="w-full px-3 py-2 text-[14px] bg-surface border border-yellow-500/50 rounded-[6px] text-text placeholder:text-text-dim outline-none focus:border-yellow-400 mb-2"
        />
        {errorMsg && (
          <p className="text-[12px] text-red-400 mb-2">{errorMsg}</p>
        )}
        <button
          type="button"
          onClick={handleAddressSubmit}
          disabled={status === 'loading' || !query.trim()}
          className="w-full py-2 text-[13px] font-medium bg-accent text-white rounded-[6px] disabled:opacity-50 mb-2"
        >
          {status === 'loading' ? 'Searching…' : 'Use this address'}
        </button>
        <button
          type="button"
          onClick={() => { setMode('search'); setQuery(''); setErrorMsg(null); setStatus('idle') }}
          className="w-full text-[12px] text-text-dim text-center"
        >
          ← Back to search
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full text-[12px] text-text-dim text-center mt-1"
          >
            Cancel
          </button>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-text-dim uppercase tracking-wide">
        Search
      </div>
      <div className="relative mb-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Times Square, Fisherman's Wharf…"
          autoFocus
          className="w-full px-3 py-2 text-[14px] bg-surface border border-border rounded-[6px] text-text placeholder:text-text-dim outline-none focus:border-accent"
        />
        {status === 'loading' && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <Loading size={14} className="text-text-dim" />
          </span>
        )}
      </div>
      {errorMsg && (
        <p className="text-[12px] text-red-400 mb-2">{errorMsg}</p>
      )}
      {results.length === 0 && query.trim() && status === 'idle' && (
        <p className="text-[12px] text-text-dim mb-2">
          No matches found. Try a different search or use exact address.
        </p>
      )}
      {results.length > 0 && (
        <div className="divide-y divide-border mb-2">
          {results.map((loc, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(loc)}
              className="w-full text-left py-2.5 px-1 hover:bg-surface rounded transition-colors"
            >
              <div className="text-[13px] text-text">{loc.label.split(',')[0]}</div>
              <div className="text-[11px] text-text-dim">
                {loc.label.split(',').slice(1).join(',').trim()}
              </div>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => { setMode('address'); setQuery(''); setResults([]); setErrorMsg(null) }}
        className="w-full text-[12px] text-accent text-center mb-1"
      >
        Or enter an exact address
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="w-full text-[12px] text-text-dim text-center"
        >
          Cancel
        </button>
      )}
    </div>
  )
}

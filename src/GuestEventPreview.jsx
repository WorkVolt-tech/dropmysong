import React, { useEffect, useState } from 'react';
import GuestRequestForm from './GuestRequestForm.jsx';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../js/config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export default function GuestEventPreview({ slug, language }) {
  const [event, setEvent] = useState(null);
  const [state, setState] = useState('loading');

  useEffect(() => {
    let active = true;
    let channel = null;
    let eventId = null;
    setState('loading');
    setEvent(null);
    const refresh = async () => {
      try {
        const { data, error } = await supabase.rpc('get_public_event', { p_slug: slug });
        if (!active) return;
        if (error || !data?.length) { setState('missing'); return; }
        const latest = data[0];
        setEvent(previous => previous && JSON.stringify(previous) === JSON.stringify(latest) ? previous : latest);
        setState('ready');
        if (latest.id && latest.id !== eventId) {
          eventId = latest.id;
          if (channel) supabase.removeChannel(channel);
          channel = supabase.channel('dropmysong-event-settings-' + eventId)
            .on('broadcast', { event:'settings-updated' }, refresh)
            .subscribe();
        }
      } catch { if (active) setState('missing'); }
    };
    const onVisible = () => { if (!document.hidden) refresh(); };
    refresh();
    const timer = setInterval(refresh, 6000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [slug]);

  const fr = language === 'fr';
  const guestUrl = new URL('/index.html', window.location.origin);
  guestUrl.searchParams.set('event', slug);

  if (state === 'loading') return <section className="event-preview" role="status">{fr ? 'Chargement de votre événement…' : 'Loading your event…'}</section>;
  if (state === 'missing') return <section className="event-preview" role="alert">{fr ? 'Événement introuvable. Vérifiez votre lien ou code QR.' : 'Event not found. Check your link or QR code.'}</section>;

  return (
    <section className="event-preview" aria-label={fr ? 'Événement actuel' : 'Current event'}>
      <span className="event-label">{fr ? 'ÉVÉNEMENT ACTUEL' : 'CURRENT EVENT'}</span>
      <h2>{event.name}</h2>
      {event.event_date && <p>{new Date(event.event_date + 'T00:00:00').toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}</p>}
      <div className="event-availability">
        <span>{fr ? 'Demandes' : 'Song requests'}: <strong>{event.requests_enabled ? (fr ? 'Ouvertes' : 'Open') : (fr ? 'En pause' : 'Paused')}</strong></span>
        <span>{fr ? 'Karaoké' : 'Karaoke'}: <strong>{event.karaoke_enabled === false ? (fr ? 'En pause' : 'Paused') : (fr ? 'Disponible' : 'Available')}</strong></span>
      </div>
      <a className="module-link" href={guestUrl.pathname + guestUrl.search}>{fr ? 'Faire une demande' : 'Request a song'} <span aria-hidden="true">→</span></a>
    <GuestRequestForm event={event} slug={slug} language={language} />
    </section>
  );
}

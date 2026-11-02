import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../js/config.js';

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});

export default function DjEventOverview({language}) {
  const fr=language==='fr';
  const [session,setSession]=useState(null);
  const [events,setEvents]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    const load=async ()=>{
      const {data}=await db.auth.getSession();
      if(!active)return;
      setSession(data.session);
      if(!data.session){setEvents([]);setLoading(false);return;}
      const result=await db.from('events').select('id,name,slug,event_date,is_active,requests_enabled,karaoke_enabled,tips_visible').order('created_at',{ascending:false});
      if(!active)return;
      setEvents(result.data||[]);
      setError(result.error?.message||'');
      setLoading(false);
    };
    load();
    const {data:{subscription}}=db.auth.onAuthStateChange(()=>{setLoading(true);load();});
    return ()=>{active=false;subscription.unsubscribe();};
  },[]);
  if(loading) return <section className="dj-preview"><p>{fr?'Chargement des événements…':'Loading events…'}</p></section>;
  if(!session)return <section className="dj-preview"><h2>{fr?'Gestion DJ':'DJ management'}</h2><p>{fr?'Connectez-vous dans le tableau de bord DJ pour voir vos événements.':'Sign in through the DJ dashboard to view your events.'}</p><a className="module-link" href="/dj.html">{fr?'Ouvrir le tableau de bord':'Open DJ dashboard'} →</a></section>;
  return <section className="dj-preview">
    <h2>{fr?'Vos événements':'Your events'}</h2>
    {error&&<p role="alert">{error}</p>}
    {!error&&!events.length&&<p>{fr?'Aucun événement.':'No events yet.'}</p>}
    <div className="dj-event-grid">{events.map(e=><article key={e.id} className="dj-event">
      <div className="dj-event-head"><strong>{e.name}</strong><small>{e.is_active?(fr?'Actif':'Active'):(fr?'Archivé':'Archived')}</small></div>
      {e.event_date&&<p>{e.event_date}</p>}
      <div className="dj-event-flags">
        <span>{fr?'Demandes':'Requests'}: {e.requests_enabled?'ON':'OFF'}</span>
        <span>{fr?'Karaoké':'Karaoke'}: {e.karaoke_enabled!==false?'ON':'OFF'}</span>
        <span>{fr?'Pourboires':'Tips'}: {e.tips_visible!==false?'ON':'OFF'}</span>
      </div>
      <div className="dj-event-actions">
        <a href={'/index.html?event='+encodeURIComponent(e.slug)}>{fr?'Demandes':'Requests'}</a>
        <a href={'/karaoke.html?event='+encodeURIComponent(e.id)}>{fr?'Écran TV':'TV screen'}</a>
      </div>
    </article>)}</div>
    <p><a className="module-link" href="/dj.html">{fr?'Gérer les événements':'Manage events'} →</a></p>
  </section>;
}

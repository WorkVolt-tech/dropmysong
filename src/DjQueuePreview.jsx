import React,{useCallback,useEffect,useState} from 'react';
import {createClient} from '@supabase/supabase-js';
import {SUPABASE_URL,SUPABASE_ANON_KEY} from '../js/config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
export default function DjQueuePreview({eventId,language}){
  const fr=language==='fr';
  const [items,setItems]=useState([]);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(true);
  const [updating,setUpdating]=useState('');
  const [notice,setNotice]=useState('');
  const refresh=useCallback(async()=>{
    const {data,error}=await supabase.from('song_requests')
      .select('id,request_type,artist,song,requester_name,status,payment_status,tip_amount,sort_order,created_at')
      .eq('event_id',eventId)
      .order('sort_order',{ascending:true})
      .order('created_at',{ascending:true});
    if(error)setError(error.message);
    else {setError('');setItems(data||[]);}
    setBusy(false);
  },[eventId]);
  useEffect(()=>{
    let active=true;
    const update=()=>{if(active)refresh();};
    setBusy(true);update();
    const channel=supabase.channel('dms-react-queue-'+eventId)
      .on('postgres_changes',{event:'*',schema:'public',table:'song_requests',filter:'event_id=eq.'+eventId},update).subscribe();
    const timer=window.setInterval(update,12000);
    return()=>{active=false;window.clearInterval(timer);supabase.removeChannel(channel);};
  },[eventId,refresh]);

  async function updateSong(row,next) {
    if(updating || (row.request_type||'song')!=='song') return;
    const transitions={pending:['accepted','rejected','cant_find'],cant_find:['accepted','rejected'],accepted:['playing','played'],playing:['played','accepted']};
    if(!transitions[row.status]?.includes(next)) return;
    if(row.payment_status==='pending' && ['accepted','playing','played'].includes(next)){
      setNotice(fr?'Paiement à confirmer.':'Payment must be confirmed first.');return;
    }
    setUpdating(row.id);setNotice('');
    const changes={status:next,updated_at:new Date().toISOString()};
    if(next==='played') changes.played_at=new Date().toISOString();
    const {data,error}=await supabase.from('song_requests').update(changes)
      .eq('id',row.id).eq('event_id',eventId).eq('status',row.status).select('id');
    if(error)setNotice(error.message);
    else if(!data?.length)setNotice(fr?'Demande modifiée. Actualisation…':'Request changed. Refreshing…');
    await refresh();setUpdating('');
  }
  const sections=[{type:'song',title:fr?'Demandes de chansons':'Song requests'},{type:'karaoke',title:fr?'File karaoké':'Karaoke queue'}];
  return <div className="dj-queue-preview" aria-label={fr?'File de demandes':'Request queue'}>
    {busy&&<p role="status">{fr?'Chargement des demandes…':'Loading requests…'}</p>}
    {error&&<p role="alert">{error}</p>}
    {!error&&sections.map(section=>{
      const rows=items.filter(x=>(x.request_type||'song')===section.type&&['pending','cant_find','accepted','playing'].includes(x.status));
      return <section key={section.type}>
        <h3>{section.title} <small>{rows.length}</small></h3>
        {!rows.length?<p className="dj-queue-empty">{fr?'Aucune demande active.':'No active requests.'}</p>:
        <div className="dj-queue-list">{rows.map(row=><article key={row.id} className="dj-queue-item">
          <div><strong>{row.artist} — {row.song}</strong>
          <p>{row.requester_name|| (fr?'Invité':'Guest')}</p></div>
          <div className="dj-queue-meta"><span>{row.status}</span>{Number(row.tip_amount)>0&&<small>{Number(row.tip_amount).toLocaleString(fr?'fr-CA':'en-CA',{style:'currency',currency:'CAD'})} · {row.payment_status||'pending'}</small>}</div>
          {section.type==='song'&&<div className="dj-song-controls">
            {(row.status==='pending'||row.status==='cant_find')&&<>
              <button disabled={!!updating||row.payment_status==='pending'} onClick={()=>updateSong(row,'accepted')}>{fr?'Accepter':'Accept'}</button>
              <button disabled={!!updating} onClick={()=>updateSong(row,'rejected')}>{fr?'Refuser':'Reject'}</button>
              {row.status==='pending'&&<button disabled={!!updating} onClick={()=>updateSong(row,'cant_find')}>{fr?'Introuvable':"Can't find"}</button>}
            </>}
            {row.status==='accepted'&&<>
              <button disabled={!!updating||row.payment_status==='pending'} onClick={()=>updateSong(row,'playing')}>{fr?'En cours':'Playing'}</button>
              <button disabled={!!updating||row.payment_status==='pending'} onClick={()=>updateSong(row,'played')}>{fr?'Terminé':'Played'}</button>
            </>}
            {row.status==='playing'&&<>
              <button disabled={!!updating||row.payment_status==='pending'} onClick={()=>updateSong(row,'played')}>{fr?'Terminé':'Played'}</button>
              <button disabled={!!updating} onClick={()=>updateSong(row,'accepted')}>{fr?'Retour':'Back to queue'}</button>
            </>}
          </div>}
        </article>)}</div>}
      </section>;
    })}
    {notice&&<p role="status" className="dj-queue-hint">{notice}</p>}
    <p className="dj-queue-hint">{fr?'Les chansons sont contrôlables ici. Utilisez le tableau de bord pour le karaoké et les paiements.':'Song controls are available here. Use the original dashboard for karaoke and payment confirmations.'}</p>
  </div>;
}

import React, { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { getOrCreateGuestToken, isHttpUrl } from '../js/common.js';
import { getLinkPreview } from '../js/linkPreview.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY, ETRANSFER_EMAIL } from '../js/config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const messages = {
  en: { artist:'Artist',song:'Song',url:'Song link (optional)',name:'Your name',message:'Dedication (optional)',submit:'Submit request',karaoke:'Karaoke',songRequest:'Song request',tip:'Tip',noTip:'No tip',payment:'Payment method',paypal:'PayPal',etransfer:'Interac e-Transfer',sender:'Exact e-transfer sender name',required:'A tip is required for this event.',missing:'Enter an artist and song, or use the full request page for a song link.',nameRequired:'Singer name is required.',paymentRequired:'Choose a payment method.',senderRequired:'Enter the name used for the transfer.',sending:'Submitting…',success:'Request received!',pending:'Waiting for DJ',error:'Could not submit your request.',paypalOpen:'Continue to PayPal',full:'Open full guest page',paused:'Requests are currently paused.',status:'Your request status',tipInfo:'Tips are confirmed by the DJ or PayPal.',checkoutError:'PayPal checkout could not start. Open your request page to retry.',retry:'Retry PayPal checkout',paid:'Payment confirmed',pendingPay:'Payment awaiting confirmation',ready:'You’re up! Please come to the DJ area.',enableAlert:'Enable karaoke alerts',alertsEnabled:'Karaoke alerts enabled' },
  fr: { artist:'Artiste',song:'Chanson',url:'Lien de chanson (facultatif)',name:'Votre nom',message:'Dédicace (facultatif)',submit:'Envoyer la demande',karaoke:'Karaoké',songRequest:'Demande de chanson',tip:'Pourboire',noTip:'Sans pourboire',payment:'Mode de paiement',paypal:'PayPal',etransfer:'Virement Interac',sender:'Nom exact de l’expéditeur',required:'Un pourboire est requis pour cet événement.',missing:'Indiquez l’artiste et la chanson, ou utilisez la page complète pour un lien.',nameRequired:'Le nom du chanteur est obligatoire.',paymentRequired:'Choisissez un mode de paiement.',senderRequired:'Indiquez le nom utilisé pour le virement.',sending:'Envoi…',success:'Demande reçue !',pending:'En attente du DJ',error:'Impossible d’envoyer la demande.',paypalOpen:'Continuer vers PayPal',full:'Ouvrir la page complète',paused:'Les demandes sont en pause.',status:'Statut de votre demande',tipInfo:'Les pourboires sont confirmés par le DJ ou PayPal.',checkoutError:'Impossible d’ouvrir PayPal. Ouvrez la page de demande pour réessayer.',retry:'Réessayer le paiement PayPal',paid:'Paiement confirmé',pendingPay:'Paiement en attente de confirmation',ready:'À votre tour ! Présentez-vous au DJ.',enableAlert:'Activer les alertes karaoké',alertsEnabled:'Alertes karaoké activées' },
};
const initial = { artist:'',song:'',url:'',name:'',message:'',sender:'' };
export default function GuestRequestForm({ event, slug, language }) {
  const t = messages[language === 'fr' ? 'fr' : 'en'];
  const [mode,setMode] = useState('song');
  const [fields,setFields] = useState(initial);
  const [amount,setAmount] = useState(0);
  const [method,setMethod] = useState('');
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const [returnProcessing,setReturnProcessing] = useState(false);
  const [request,setRequest] = useState(null);
  const [status,setStatus] = useState('');
  const [paymentStatus,setPaymentStatus] = useState('');
  const [options,setOptions] = useState(null);
  const [preview,setPreview] = useState(null);
  const [previewBusy,setPreviewBusy] = useState(false);
  const [readyMessage,setReadyMessage] = useState('');
  const [notificationsEnabled,setNotificationsEnabled] = useState(() => typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const announcedVersion = useRef(null);
  const guestUrl = new URL('/index.html',window.location.origin);
  guestUrl.searchParams.set('event',slug);
  const guestHref = guestUrl.pathname+guestUrl.search;

  useEffect(() => {
    let active = true;
    let checking = false;
    const refresh = async () => {
      if (checking) return;
      checking = true;
      try {
        const [opt,vis] = await Promise.all([
          supabase.from('dropmysong_event_options')
            .select('karaoke_enabled,tips_enabled,tip_options,paypal_enabled,etransfer_enabled')
            .eq('id',event.id).limit(1),
          supabase.rpc('get_event_tip_visibility',{p_event_id:event.id}),
        ]);
        if (!active || opt.error || vis.error) return;
        const o = opt.data?.[0] || {};
        const next = {
          karaoke_enabled:o.karaoke_enabled ?? true,
          tips_enabled:o.tips_enabled ?? event.tips_enabled,
          tips_visible:vis.data?.[0]?.tips_visible !== false,
          tip_options:Array.isArray(o.tip_options) ? o.tip_options : [5,10,15,20],
          paypal_enabled:true,
          etransfer_enabled:true,
        };
        setOptions(previous => previous && JSON.stringify(previous)===JSON.stringify(next) ? previous : next);
      } catch (error) {
        console.debug('Guest payment settings refresh failed:',error?.message||error);
      } finally { checking = false; }
    };
    const channel = supabase.channel('dropmysong-event-settings-'+event.id)
      .on('broadcast',{event:'settings-updated'},refresh).subscribe();
    const timer = setInterval(refresh,6000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange',onVisible);
    refresh();
    return () => {
      active=false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange',onVisible);
      supabase.removeChannel(channel);
    };
  },[event.id,event.tips_enabled]);

  useEffect(() => {
    // Rehydrate the existing request record without issuing any duplicate INSERT.
    try {
      const last=JSON.parse(localStorage.getItem('dropmysong_last_'+slug)||'null');
      if (last?.id) {
        setRequest(last);
        setStatus(last.status||'pending');
        setPaymentStatus(last.payment_status||'');
      } else {
        setRequest(null);setStatus('');setPaymentStatus('');
      }
    } catch { setRequest(null);setStatus('');setPaymentStatus(''); }
  }, [slug]);

  useEffect(() => {
    if (!request?.id) return;
    let active=true;
    const refresh=async () => {
      const token=getOrCreateGuestToken();
      const {data}=await supabase.rpc('get_request_status',{p_request_id:request.id,p_guest_token:token});
      if (active && data?.[0]) {
        const row=data[0];
        setStatus(row.status || '');
        setPaymentStatus(row.payment_status || '');
        if ((row.request_type || request.request_type)==='karaoke' && row.status==='playing' && announcedVersion.current!==row.updated_at) {
          announcedVersion.current=row.updated_at;
          setReadyMessage(messages[language==='fr'?'fr':'en'].ready);
          if (typeof Notification!=='undefined' && Notification.permission==='granted') {
            try { new Notification('DropMySong 🎤',{body:messages[language==='fr'?'fr':'en'].ready,tag:'dms-ready-'+request.id}); } catch { /* in-page alert remains visible */ }
          }
        }
      }
    };
    refresh();
    const channel=supabase.channel('react-guest-'+request.id).on('postgres_changes',{event:'UPDATE',schema:'public',table:'song_requests',filter:'id=eq.'+request.id},refresh).subscribe();
    const timer=window.setInterval(refresh,12000);
    return () => { active=false;window.clearInterval(timer);supabase.removeChannel(channel); };
  },[request?.id,language]);

  useEffect(() => {
    const url=fields.url.trim();
    if (!url || !isHttpUrl(url)) { setPreview(null);setPreviewBusy(false);return; }
    let active=true;
    setPreviewBusy(true);
    const timer=window.setTimeout(() => {
      getLinkPreview(url, { title:fields.song,subtitle:fields.artist }).then(data=>{
        if(!active) return;
        setPreview(data);
        // Do not override artist/title explicitly typed by the guest.
        setFields(old=>old.url.trim()===url ? ({
          ...old,
          artist:old.artist || (data?.artistName && data.artistName!=='Artist not provided' ? data.artistName.slice(0,120) : ''),
          song:old.song || (data?.trackTitle && data.trackTitle!=='Linked song' ? data.trackTitle.slice(0,160) : ''),
        }):old);
      }).catch(()=>{if(active)setPreview(null);}).finally(()=>{if(active)setPreviewBusy(false);});
    },500);
    return ()=>{active=false;window.clearTimeout(timer);};
  },[fields.url]);

  function pushKey(value) {
    const base64=(value+'='.repeat((4-value.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/');
    return Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  }

  async function enableKaraokeAlerts() {
    if (typeof Notification==='undefined' || !window.isSecureContext) return;
    const permission=await Notification.requestPermission();
    setNotificationsEnabled(permission==='granted');
    if (permission!=='granted' || !request?.id || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const registration=await navigator.serviceWorker.ready;
      let subscription=await registration.pushManager.getSubscription();
      if (!subscription) subscription=await registration.pushManager.subscribe({
        userVisibleOnly:true,applicationServerKey:pushKey(VAPID_PUBLIC_KEY),
      });
      const details=subscription.toJSON();
      const {error}=await supabase.from('push_subscriptions').insert({
        request_id:request.id,guest_token:getOrCreateGuestToken(),
        endpoint:details.endpoint,p256dh:details.keys?.p256dh,auth:details.keys?.auth,
        language,page_url:location.href,
      });
      if(error) throw error;
      localStorage.setItem('dropmysong_push_request_'+slug,request.id);
      setNotice(t.alertsEnabled);
    } catch(error) {
      setNotice(error?.message||t.error);
    }
  }

  const change=(key,value)=>setFields(old=>({...old,[key]:value}));
  const visible=options?.tips_visible !== false;
  const required=visible && !!options?.tips_enabled;
  const enabled=mode==='karaoke'?options?.karaoke_enabled !== false:event.requests_enabled !== false;

  useEffect(() => {
    const params=new URLSearchParams(window.location.search);
    const mode=params.get('paypal');
    if (!mode) return;
    const clean=() => {
      const url=new URL(window.location.href);
      for(const key of ['paypal','request','token','PayerID']) url.searchParams.delete(key);
      window.history.replaceState({},'',url);
    };
    if(mode==='cancel') {
      setNotice(language==='fr'?'Paiement annulé. Vous pouvez réessayer.':'Payment cancelled. You can try again.');
      clean();
      return;
    }
    if(mode!=='return') return;
    const id=params.get('request'),order=params.get('token');
    if(!id||!order) {
      setNotice(t.checkoutError);clean();return;
    }
    let active=true;
    setReturnProcessing(true);
    (async()=>{
      try {
        const response=await fetch(SUPABASE_URL+'/functions/v1/paypal-payment',{
          method:'POST',
          headers:{'Content-Type':'application/json',apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+SUPABASE_ANON_KEY},
          body:JSON.stringify({action:'capture',request_id:id,order_id:order,guest_token:getOrCreateGuestToken(),language}),
        });
        const data=await response.json().catch(()=>null);
        if(!response.ok||!data?.confirmed) throw Error(data?.error||t.checkoutError);
        if(active){setPaymentStatus('confirmed');setNotice(t.paid);}
      }catch(error){if(active)setNotice(error?.message||t.checkoutError);}
      finally{if(active)setReturnProcessing(false);clean();}
    })();
    return ()=>{active=false;};
  },[slug]);

  async function openPayPal(savedRequest) {
    const token=getOrCreateGuestToken();
    const response=await fetch(SUPABASE_URL+'/functions/v1/paypal-payment',{
      method:'POST',
      headers:{'Content-Type':'application/json',apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+SUPABASE_ANON_KEY},
      body:JSON.stringify({action:'create',request_id:savedRequest.id,guest_token:token,language}),
    });
    const result=await response.json().catch(()=>null);
    if(!response.ok||(!result?.approve_url&&!result?.confirmed)) throw Error(result?.error||t.checkoutError);
    if(result.confirmed) {setPaymentStatus('confirmed');return;}
    window.location.assign(result.approve_url);
  }

  async function cancelCurrentRequest() {
    if (!request?.id || busy || returnProcessing || Number(request.tip_amount||0)>0 || !['pending','cant_find','accepted'].includes(status||'pending')) return;
    if (!window.confirm(language==='fr'?'Annuler cette demande ?':'Cancel this request?')) return;
    setBusy(true);
    try {
      const {data,error}=await supabase.rpc('cancel_guest_request',{
        p_request_id:request.id,p_guest_token:getOrCreateGuestToken(),
      });
      if (error || !data) throw Error(error?.message || (language==='fr'?'Annulation impossible.':'Cannot cancel this request.'));
      setStatus('rejected');
      setNotice(language==='fr'?'Votre demande a été annulée.':'Your request was cancelled.');
      localStorage.setItem('dropmysong_last_'+slug,JSON.stringify({...request,status:'rejected'}));
    } catch(error){setNotice(error.message||t.error);}
    finally{setBusy(false);}
  }

  async function retryPayPal() {
    if (!request || busy || returnProcessing) return;
    setBusy(true);setNotice('');
    try { await openPayPal(request); }
    catch(error) { setNotice(error?.message||t.checkoutError); }
    finally { setBusy(false); }
  }

  async function submit(e) {
    e.preventDefault();
    setNotice('');
    if (!options) return;
    const artist=fields.artist.trim(), song=fields.song.trim(), name=fields.name.trim();
    const url=fields.url.trim();
    if ((!artist || !song) && !url) return setNotice(t.missing);
    if (url&&!isHttpUrl(url)) return setNotice(language==='fr'?'Lien invalide. Utilisez une adresse https:// valide.':'Invalid link. Please enter a valid https:// URL.');
    // Mirror the original guest page's metadata fallbacks for link-only requests.
    let finalArtist=artist, finalSong=song;
    if (url&&(!finalArtist||!finalSong)) {
      const metadata=preview?.url===url?preview:await getLinkPreview(url,{title:song,subtitle:artist});
      if (metadata?.needsManualMetadata || !metadata?.trackTitle) {
        setNotice(language==='fr'
          ? 'Titre YouTube introuvable. Entrez le nom de l’artiste et de la chanson.'
          : 'YouTube title unavailable. Enter the artist and song manually.');
        return;
      }
      finalArtist ||= metadata?.artistName || '';
      finalSong ||= metadata?.trackTitle || '';
    }
    if (!finalArtist || !finalSong || /^(Artist not provided|Linked song)$/i.test(finalArtist) || /^(watch|Linked song|Song from link)$/i.test(finalSong)) {
      return setNotice(language==='fr'?'Entrez un véritable artiste et titre.':'Enter the actual artist and song title.');
    }
    if (mode==='karaoke'&&!name) return setNotice(t.nameRequired);
    if (required&&!amount) return setNotice(t.required);
    if (amount&&!method) return setNotice(t.paymentRequired);
    if (amount&&method==='etransfer'&&!fields.sender.trim()) return setNotice(t.senderRequired);
    setBusy(true);
    try {
      const id=crypto.randomUUID();
      const token=getOrCreateGuestToken();
      const payload={
        id,event_id:event.id,request_type:mode,artist:finalArtist.slice(0,120),song:finalSong.slice(0,160),
        song_url:url||null,requester_name:name?name.slice(0,80):null,message:fields.message.trim().slice(0,200)||null,
        tip_amount:amount||null,payment_method:amount?method:null,
        payment_status:amount?'pending':'not_required',
        payment_sender_name:method==='etransfer'?fields.sender.trim().slice(0,120):null,guest_token:token,
      };
      const {error}=await supabase.from('song_requests').insert(payload);
      if(error) throw error;
      const saved={id,artist:payload.artist,song:payload.song,request_type:mode,tip_amount:payload.tip_amount,payment_method:payload.payment_method,payment_status:payload.payment_status,etransfer_email:ETRANSFER_EMAIL};
      localStorage.setItem('dropmysong_last_'+slug,JSON.stringify(saved));
      announcedVersion.current=null;setReadyMessage('');setRequest(saved);setStatus('pending');setPaymentStatus(saved.payment_status);setFields(initial);setPreview(null);setNotice(t.success);
      if(amount&&method==='paypal'){
        // The established PayPal backend returns to index.html for verified capture.
        await openPayPal(saved);
      }
    } catch(error) {setNotice(error?.message||t.error);}
    finally {setBusy(false);}
  }
  return <section className="react-guest-form" aria-label={t.songRequest}>
    <div className="request-types">
      <button type="button" className={mode==='song'?'active':''} onClick={()=>setMode('song')}>{t.songRequest}</button>
      <button type="button" className={mode==='karaoke'?'active':''} onClick={()=>setMode('karaoke')}>{t.karaoke}</button>
    </div>
    {!options ? <p><a href={guestHref}>{t.full} →</a></p> : !enabled ? <p role="status">{t.paused}</p> :
    <form onSubmit={submit}>
      <label>{t.artist}<input required={!fields.url.trim()} maxLength={120} value={fields.artist} onChange={e=>change('artist',e.target.value)}/></label>
      <label>{t.song}<input required={!fields.url.trim()} maxLength={160} value={fields.song} onChange={e=>change('song',e.target.value)}/></label>
      <label>{t.url}<input type="url" maxLength={2000} placeholder="https://www.youtube.com/watch?v=…" value={fields.url} onChange={e=>change('url',e.target.value)}/></label>
      {previewBusy&&<p role="status" className="muted">{language==='fr'?'Recherche de la chanson…':'Looking up song information…'}</p>}
      {preview&&fields.url.trim()===preview.url&&<div className="react-link-preview">
        {preview.imageUrl&&<img src={preview.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer"/>}
        <div><strong>{preview.trackTitle||preview.title}</strong><p>{preview.artistName||preview.providerName}</p><small>{preview.providerName}</small></div>
      </div>}
      <label>{t.name}<input required={mode==='karaoke'} maxLength={80} value={fields.name} onChange={e=>change('name',e.target.value)}/></label>
      <label>{t.message}<textarea maxLength={200} value={fields.message} onChange={e=>change('message',e.target.value)}/></label>
      {visible && <fieldset><legend>{t.tip}{required?' *':''}</legend>
        <div className="react-tip-options">{!required&&<button type="button" className={!amount?'selected':''} onClick={()=>{setAmount(0);setMethod('');}}>{t.noTip}</button>}
        {options.tip_options.filter(x=>Number.isFinite(Number(x))&&Number(x)>0).map(x=><button key={x} type="button" className={amount===Number(x)?'selected':''} onClick={()=>setAmount(Number(x))}>${Number(x)}</button>)}</div>
        {amount>0&&<><label>{t.payment}<select required value={method} onChange={e=>setMethod(e.target.value)}><option value="">—</option>{options.paypal_enabled&&<option value="paypal">{t.paypal}</option>}{options.etransfer_enabled&&<option value="etransfer">{t.etransfer}</option>}</select></label>
        {method==='etransfer'&&<><p>{ETRANSFER_EMAIL}</p><label>{t.sender}<input required maxLength={120} value={fields.sender} onChange={e=>change('sender',e.target.value)}/></label></>}</>}
        <p className="muted">{t.tipInfo}</p>
      </fieldset>}
      <button className="module-link" type="submit" disabled={busy}>{busy?t.sending:t.submit}</button>
    </form>}
    {returnProcessing&&<p role="status" className="form-feedback">{language==='fr'?'Vérification du paiement PayPal…':'Verifying PayPal payment…'}</p>}
    {notice&&<p role="status" className="form-feedback">{notice}</p>}
    {readyMessage&&<div className="form-feedback karaoke-ready-alert" role="alert">🎤 {readyMessage}</div>}
    {request?.request_type==='karaoke' && typeof Notification!=='undefined' && !notificationsEnabled && <button type="button" className="alert-enable" onClick={enableKaraokeAlerts}>{t.enableAlert}</button>}
    {request&&['pending','cant_find','accepted','playing'].includes(status||'pending')&&<div className="form-feedback" role="status"><strong>{t.status}: {status||t.pending}</strong><p>{request.artist} — {request.song}</p>{request.payment_method==='paypal'&&<><p>{paymentStatus==='confirmed'?t.paid:t.pendingPay}</p>{paymentStatus!=='confirmed'&&<button type="button" className="module-link" onClick={retryPayPal} disabled={busy}>{t.retry}</button>}</>}{Number(request.tip_amount||0)===0&&['pending','cant_find','accepted'].includes(status||'pending')&&<button className="alert-enable" type="button" onClick={cancelCurrentRequest} disabled={busy}>{language==='fr'?'Annuler la demande':'Cancel request'}</button>}<p><a href={guestHref}>{t.full} →</a></p></div>}
    <p className="full-guest-link"><a href={guestHref}>{t.full} →</a></p>
  </section>;
}

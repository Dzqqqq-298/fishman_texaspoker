import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Native modal semantics keep focus inside the panel and restore its trigger. */
export function Overlay({title,kind='drawer',onClose,children}:{title:string;kind?:'drawer'|'sheet';onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null),heading=useId(),close=useRef(onClose);
  close.current=onClose;
  useEffect(()=>{
    const dialog=ref.current!,previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;
    dialog.showModal();document.body.style.overflow='hidden';
    return()=>{dialog.close();document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();};
  },[]);
  return <dialog ref={ref} className={`game-overlay ${kind}`} aria-labelledby={heading}
    onKeyDown={e=>{
      if(e.key!=='Tab')return;
      const controls=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex="0"]')).filter(el=>el.getClientRects().length>0);
      const first=controls[0],last=controls.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }}
    onCancel={e=>{e.preventDefault();close.current();}}
    onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close.current();}}}>
    <header className="overlay-heading"><h2 id={heading}>{title}</h2><button type="button" className="overlay-close" aria-label="关闭" onClick={onClose}>×</button></header>
    <div className="overlay-content">{children}</div>
  </dialog>;
}

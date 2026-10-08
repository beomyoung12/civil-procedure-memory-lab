(function(root){'use strict';
const norm=s=>String(s??'').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const choices=term=>[term,...(root.CivilLearning.aliases[term]||[])];
function bareWords(word){return word.split(/\s+/).map(part=>word.includes(' ')&&part.endsWith('의')?part.slice(0,-1):part).filter(Boolean);}
const critical=/^(?:적법|부적법|유효|무효|당연무효|유동적무효|확정적|각하|기각|소각하|청구기각판결|허용|가능|불가|긍정|부정|효력|귀속|구속력|구속|기판력|이전|산입|소멸|중단|수령|추심|상실|판단|신의칙위반)$/;
function wordOccurrences(text,words){
 const candidates=[];
 for(const word of words){let at=0;while((at=text.indexOf(word,at))>=0){candidates.push({start:at,end:at+word.length,word});at+=word.length;}}
 candidates.sort((a,b)=>a.start-b.start||b.end-a.end);let end=-1;
 return candidates.filter(x=>{if(x.start<end)return false;end=x.end;return true;});
}
function split(text){
 // 문장·원문 항목 단위. 의미 내용을 삭제하지 않는다. 출처 두문자만 학습 표시에서 제외.
 return text.replace(/\[(?:[^\]]+)\]/g,'').split(/(?<=[.!?。])\s+|\n+|(?=[①②③④⑤㉠㉡])|(?=\bi{1,3}\))/).map(s=>s.trim()).filter(Boolean);
}
function compile(){
 return root.CivilSource.questions.map(q=>{
   const notes=root.CivilCorrections.filter(c=>c.question===q.number);let text=q.originalAnswer;
   for(const note of notes){for(const [a,b] of note.patch||[])text=text.replace(a,b);if(note.hold)text=text.replace(note.hold,'');}
   const vocabulary=[...new Set(root.CivilLearning.words[q.number].split('|').flatMap(bareWords))];
   const pieces=split(text).filter(t=>!/^\([12]\) 제3자가/.test(t)&&!/^\([123]\) .*확정된 경우$/.test(t)),texts=[];let pending='';
   for(const piece of pieces){if(!wordOccurrences(piece,vocabulary).length){pending+=(pending?' ':'')+piece;continue;}texts.push((pending?pending+' ':'')+piece);pending='';}
   if(pending){if(texts.length)texts[texts.length-1]+=' '+pending;else texts.push(pending);}
   const tableTexts=q.table?q.table.rows.map(row=>row.join(' : ')):[];
   const units=[...texts,...tableTexts].map((t,i)=>{const hits=wordOccurrences(t,vocabulary);return {id:`${q.id}.u${i+1}`,text:t,table:i>=texts.length,terms:hits.map((h,j)=>({...h,id:`${q.id}.u${i+1}.t${j+1}`,aliases:choices(h.word)}))};});
   return {...q,notes,studyAnswer:text,units,progression:root.CivilLearning.progressions.find(p=>q.number>=p.from&&q.number<=p.to).id};
 });
}
function findTerm(answer,term,from=0){
 let best=null;
 for(const alias of choices(term)){
   const token=norm(alias);let at=answer.indexOf(token,from);
   while(at>=0){
     // '적법'은 '부적법' 안에서, '유효'는 '유효하지 않다'의 의미 검사 없이 정답이 될 수 없다.
     if(!(term==='적법'&&answer[at-1]==='부')&&!(term==='허용'&&answer.slice(Math.max(0,at-1),at)==='불'))break;
     at=answer.indexOf(token,at+1);
   }
   if(at>=0&&(!best||at<best.at))best={at,end:at+token.length,alias};
 }
 return best;
}
function polarity(text,at,length){
 const n=norm(text), after=n.slice(at+length,at+length+22);
 // 종료 구절까지의 짧은 문맥. 복잡한 예외/대비 문장은 자동 의미 판정하지 않는다.
 const cutoff=after.search(/(?:그러나|다만|따라서|원고|피고|판례|①|②)/);const tail=cutoff>=0?after.slice(0,cutoff):after;
 return /아니|않|없|못|불가|부정|배제|제외/.test(tail)?'negative':'positive';
}
function gradeUnit(answer,unit){
 const n=norm(answer),rn=norm(unit.text);let cursor=0;const hits=[],missing=[],outOfOrder=[],contradictions=[];
 for(const term of unit.terms){
   const found=findTerm(n,term.word,cursor);
   if(!found){const anywhere=findTerm(n,term.word);(anywhere?outOfOrder:missing).push(term);continue;}
   const refAt=norm(unit.text.slice(0,term.start)).length;
   if(critical.test(term.word)&&polarity(rn,refAt,norm(term.word).length)!==polarity(n,found.at,found.end-found.at))contradictions.push(term);
   hits.push({...term,found});cursor=found.end;
 }
 // 원문 숫자·조문을 뒤집은 경우, 문장 전체에 있는 번호도 별도 비교한다.
 const refs=[...unit.text.matchAll(/제\d+조(?:\s*\d+항)?(?:\s*\d+호)?/g)].map(m=>norm(m[0]));
 const wrongReferences=refs.filter(x=>!n.includes(x));
 const total=unit.terms.length,coverage=total?Math.round(100*Math.max(0,total-missing.length-contradictions.length+refs.length-wrongReferences.length)/(total+refs.length)):0;
 const phraseScore=total?Math.round(100*hits.length/total):0;
 const ordered=total>0&&hits.length===total;
 const exact=norm(unit.text)===n;
 const keywordOnly=ordered&&!exact&&(n.length<norm(unit.text).length*.62||/^([\w가-힣]+[\s,·/|]+){2,}[\w가-힣]+$/.test(answer.trim()));
 return {unitId:unit.id,hits,missing,outOfOrder,contradictions,wrongReferences,coverage,phraseScore,ordered,pass:ordered&&!contradictions.length&&!wrongReferences.length,manual:!exact,keywordOnly};
}
function gradeBlank(answer,term){return {pass:choices(term.word).some(t=>norm(t)===norm(answer)),expected:term.word,allowed:choices(term.word)};}
function gradeUnits(answers,units){
 const details=units.map(u=>gradeUnit(answers[u.id]||'',u));
 const total=units.reduce((s,u)=>s+u.terms.length,0),referenceCount=units.reduce((s,u)=>s+[...u.text.matchAll(/제\d+조(?:\s*\d+항)?(?:\s*\d+호)?/g)].length,0), included=details.reduce((s,r)=>s+r.hits.length+r.outOfOrder.length-r.contradictions.length-r.wrongReferences.length,0), ordered=details.reduce((s,r)=>s+r.hits.length,0);
 return {details,coverage:total?Math.round(100*Math.max(0,included+referenceCount)/(total+referenceCount)):0,phraseScore:total?Math.round(100*ordered/total):0,pass:details.length>0&&details.every(r=>r.pass),manual:details.some(r=>r.manual),keywordOnly:details.some(r=>r.keywordOnly)};
}
function gradeWhole(answer,units){
 // 同じ答案内の列挙項目は順序自由、各文内の重要語順は保持。各文を入力行へ最大1回対応させる。
 let lines=answer.split(/[\n]+/).filter(s=>s.trim());
 if(lines.length<units.length){
   const vocabulary=[...new Set(units.flatMap(u=>u.terms.map(t=>t.word)))],pieces=split(answer),merged=[];let pending='';
   for(const p of pieces){if(!wordOccurrences(p,vocabulary).length){pending+=(pending?' ':'')+p;continue;}merged.push((pending?pending+' ':'')+p);pending='';}
   if(pending&&merged.length)merged[merged.length-1]+=' '+pending;
   if(merged.length>=units.length)lines=merged;
 }
 if(lines.length<units.length){
   const result=gradeUnits(Object.fromEntries(units.map(u=>[u.id,answer])),units),used=new Set();let reused=false;
   for(const r of result.details)for(const t of r.hits){const position=`${t.found.at}:${t.found.end}`;if(used.has(position))reused=true;used.add(position);}
   result.manual=true;result.ambiguous=reused;result.pass=result.pass&&!reused;return result;
 }
 const used=new Set(),assigned=new Set(),answers={},pairs=[];
 units.forEach((unit,j)=>lines.forEach((line,i)=>{const r=gradeUnit(line,unit);const score=(norm(line)===norm(unit.text)?100000:0)+(r.pass?10000:0)+r.phraseScore*20+r.hits.length-r.contradictions.length*1000;pairs.push({j,i,score});}));
 pairs.sort((a,b)=>b.score-a.score);
 for(const {j,i}of pairs){if(used.has(i)||assigned.has(j))continue;used.add(i);assigned.add(j);answers[units[j].id]=lines[i];}
 return gradeUnits(answers,units);
}
function blankTerms(unit,mode,variant=0){
 // 各単語の範囲だけを隠す。助詞は原文側に残る。密度を変えても文章の意味は変えない。
 const all=unit.terms.filter(t=>!['モ','모르','이하'].includes(t.word));
 if(mode==='expanded')return all.filter((_,i)=>i%3!==variant%3||all.length<=3);
 const weight=t=>/(?:시$|시점|각하|기각|무효|유효|부정|긍정|제\d+조|소멸|중단|예외|요건|적격|반환|금지|구속)/.test(t.word)?2:0;
 const ranked=[...all].sort((a,b)=>weight(b)-weight(a)||a.start-b.start),subset=ranked.filter((_,i)=>i%3===variant%3).sort((a,b)=>a.start-b.start);return subset.length?subset:all.slice(0,1);
}
function dayKey(time=Date.now()){const d=new Date(time);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function emptyState(){return {schema:1,sourceVersion:root.CivilSource.version,updatedAt:0,serial:0,current:{qid:'q1',mode:'word',unit:0,variant:0},drafts:{},records:{},terms:{},exposures:{},requeue:[],history:[]};}
function exposure(state,qid,now=Date.now()){
 state.exposures[qid]={at:now,serial:state.serial};
 for(const [key,draft]of Object.entries(state.drafts))if(key.startsWith(qid+':'))draft.assisted=true;
}
function isAssisted(state,qid,draft,now=Date.now()){
 const e=state.exposures[qid],others=e?new Set(state.history.filter(h=>h.at>=e.at&&h.qid!==qid).map(h=>h.qid)).size:0;
 return !!draft?.assisted||!!e&&(now-e.at<10*60*1000||others<3);
}
function record(state,qid,mode,result,rating,assisted,now=Date.now()){
 const key=`${qid}:${mode}`,r=state.records[key]||{attempts:0,independentDays:[],interval:0,streak:0};
 const success=result.pass&&rating==='exact'&&!assisted;const today=dayKey(now),newDay=!r.independentDays.includes(today);
 r.attempts++;r.lastAt=now;r.lastPass=result.pass;r.rating=rating;r.assisted=assisted;r.score=result.phraseScore??(result.pass?100:0);
 if(success&&newDay){r.independentDays.push(today);r.streak++;r.interval=[1,3,7,14,30][Math.min(r.streak-1,4)];}
 else if(!result.pass||rating==='none'){r.streak=0;r.interval=0;}
 else if(assisted||rating==='partial'){r.interval=1;}
 r.due=now+(r.interval||0)*86400000;state.records[key]=r;
 for(const detail of result.details||[]){for(const t of [...detail.hits,...detail.missing,...detail.outOfOrder]){
   const tr=state.terms[t.id]||{qid,word:t.word,seen:0,misses:0,independentDays:[]};tr.seen++;const wrong=[...detail.missing,...detail.outOfOrder,...detail.contradictions].some(x=>x.id===t.id);
   if(wrong)tr.misses++;else if(success&&!tr.independentDays.includes(today))tr.independentDays.push(today);tr.lastAt=now;state.terms[t.id]=tr;
 }}
 state.serial++;if(!result.pass||rating==='none'){state.requeue=state.requeue.filter(x=>x.qid!==qid||x.mode!==mode);state.requeue.push({qid,mode,after:state.serial+3,at:now});}
 state.history.push({qid,mode,at:now,pass:result.pass,coverage:result.coverage,phraseScore:result.phraseScore,rating,assisted,independent:success});
 state.updatedAt=now;return r;
}
function queue(state,questions,kind,now=Date.now()){
 const dueRetry=state.requeue.filter(r=>retryReady(state,r)).map(r=>r.qid),waiting=new Set(state.requeue.filter(r=>!retryReady(state,r)).map(r=>r.qid));
 const unlearned=questions.filter(q=>!Object.keys(state.records).some(k=>k.startsWith(q.id+':'))).map(q=>q.id);
 if(kind==='new')return unlearned;
 if(kind==='weak')return [...new Set(Object.values(state.terms).filter(t=>t.misses>0).sort((a,b)=>b.misses-a.misses).map(t=>t.qid))];
 if(kind==='all')return questions.map(q=>q.id);
 return [...new Set([...dueRetry,...questions.filter(q=>!waiting.has(q.id)&&Object.entries(state.records).some(([k,r])=>k.startsWith(q.id+':')&&r.due<=now)).map(q=>q.id)])].filter(id=>questions.some(q=>q.id===id));
}
function retryReady(state,r){return state.serial>=r.after&&new Set(state.history.slice(Math.max(0,r.after-3)).filter(h=>h.qid!==r.qid).map(h=>h.qid)).size>=3;}
function validateState(value){
 if(!value||value.schema!==1||!value.current||!value.drafts||!value.records||!value.terms||!value.exposures||!Array.isArray(value.history)||!Array.isArray(value.requeue)||!Number.isInteger(value.serial)||value.serial<0)throw new Error('기록 파일 형식이 맞지 않습니다. 기존 기록은 변경하지 않았습니다.');
 if(!root.CivilSource.questions.some(q=>q.id===value.current.qid)||!['word','expanded','list','sentence','whole','contrast'].includes(value.current.mode))throw new Error('문항 또는 단계 값이 올바르지 않습니다.');
 if(!Number.isInteger(value.current.unit)||value.current.unit < -1||value.current.unit>1000||!Number.isInteger(value.current.variant)||value.current.variant<0)throw new Error('부분 또는 풀이 번호가 올바르지 않습니다.');
 if(JSON.stringify(value).length>8*1024*1024)throw new Error('기록 파일이 너무 큽니다.');
 const safe=JSON.parse(JSON.stringify(value));
 for(const map of [safe.drafts,safe.records,safe.terms,safe.exposures]){if(Array.isArray(map)||typeof map!=='object')throw new Error('손상된 기록입니다.');for(const key of Object.keys(map))if(['__proto__','constructor','prototype'].includes(key))throw new Error('허용하지 않는 기록 키입니다.');}
 for(const r of Object.values(safe.records))if(!r||!Array.isArray(r.independentDays)||!Number.isFinite(r.due)||!Number.isInteger(r.attempts))throw new Error('복습 기록이 손상되었습니다.');
 for(const d of Object.values(safe.drafts))if(!d||typeof d.values!=='object'||Array.isArray(d.values)||Object.values(d.values).some(v=>typeof v!=='string'))throw new Error('작성 중 답안이 손상되었습니다.');
 return safe;
}
root.CivilCore={norm,esc,bareWords,wordOccurrences,split,compile,gradeUnit,gradeBlank,gradeUnits,gradeWhole,blankTerms,choices,dayKey,emptyState,exposure,isAssisted,record,queue,retryReady,validateState};
if(typeof module!=='undefined')module.exports=root.CivilCore;
})(typeof window==='undefined'?globalThis:window);

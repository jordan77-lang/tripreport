import { useCallback, useEffect, useRef, useState } from 'react';
import { SLOT_LABEL, mealDayOptionLabel, mealDaysLabel, mealStartDay } from '../lib/mealSlots';
import { activeMealDays, buildMealSchedule, mealCooks, mealItems, mealReminders, mealShoppingChanges } from '../lib/mealPlanning';
import { canonicalParticipantId, participantDisplayName } from '../lib/tripParticipants';
import { getCurrentUserId, isTripMember, changeMealPeriods, claimMealSlot, updateMeal, confirmMealPrep, dismissMealReminder } from '../lib/storage';
import { savePlanningLocally } from '../lib/planningSave';
import { SlotIcon } from './SlotIcon';
import { Sheet } from './MealPickers';
import { BulkMealTools, DeleteMealDialog, MealCoordination, OwnMealEditor, SharedMealSetup } from './MealPlanTools';

const STATUS_LABEL = { open: 'Open', claimed: 'Claimed', 'on-your-own': 'On your own' };

export function MealSchedule({ trip, participants, onAdd, onEdit, onTripUpdate, onOpenShopping }) {
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tools, setTools] = useState(null);
  const [undo, setUndo] = useState(null);
  const [now, setNow] = useState(Date.now);
  const latestSave = useRef(0);
  const closeTools = useCallback(() => setTools(null), []);
  function openTools(value) { setError(''); setTools(value); }
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()),60000); return () => clearInterval(timer); }, []);
  const userId = getCurrentUserId();
  const canEdit = isTripMember(trip,userId);
  const canonical = id => canonicalParticipantId(trip,id) || id;
  const mine = meal => mealCooks(meal).some(id => canonical(id) === canonical(userId));
  const schedule = buildMealSchedule(trip);
  const periodDetails = tools?.type==='period' ? schedule.find(period=>period.day===tools.period.day&&period.slot===tools.period.slot) : null;
  const attention = p => p.status === 'open' || (p.status !== 'on-your-own' && p.meals.some(m => m.menuPending || m.needsHelp));
  const matches = (p,key) => key === 'all' || (key === 'mine' ? p.status !== 'on-your-own' && p.meals.some(mine) : key === 'attention' ? attention(p) : p.status === key);
  const visible = schedule.filter(p => matches(p,filter));
  const groups = [...new Set(visible.map(p=>p.day))].map(day=>({day,periods:visible.filter(p=>p.day===day)}));
  const filters = [['all','All'],['open','Open'],['claimed','Claimed'],['mine','Mine'],['on-your-own','On your own'],['attention','Needs attention']];
  const shopping = mealShoppingChanges(trip);
  const reminders = mealReminders(trip,userId,now);
  function chooseFilter(key) { setFilter(key); }
  function openMealEditor(meal,day) { closeTools(); onEdit(meal,day); }
  function openNewMealEditor(day,slot,options) { closeTools(); onAdd(day,slot,options); }
  function editPeriod(period) { openTools({type:period.status==='on-your-own'&&canEdit?'own':'period',period}); }
  function change(saveLocal) {
    if (!canEdit) return false;
    const sequence = ++latestSave.current;
    setError('');
    try {
      savePlanningLocally(trip.id,saveLocal,{ onSaved:()=>{setNotice('Saved on this device');onTripUpdate?.();},
        onSynced:result=>{if(sequence===latestSave.current)setNotice(result?.skipped?'Saved on this device':'Synced');onTripUpdate?.();},
        onError:e=>{if(sequence===latestSave.current)setError(`Saved on this device. ${e.message || 'Sync will retry.'}`);} });
      return true;
    } catch(e) { setError(e.message || 'Could not save the meal plan.'); return false; }
  }
  function setOwn(period) {
    const previous = {day:period.day,slot:period.slot,mode:period.settings?.mode || 'shared',reason:period.settings?.reason || '',windowManaged:period.settings?.windowManaged || false};
    const saved=change(()=>changeMealPeriods(trip.id,[{day:period.day,slot:period.slot,mode:'on-your-own'}]));
    if (saved) setUndo([previous]);
    return saved;
  }
  function chooseCooks(meal,ids) {
    const lead = ids.includes(canonical(meal.assignedTo)) ? canonical(meal.assignedTo) : ids[0] || null;
    return change(()=>updateMeal(trip.id,meal.id,{assignedTo:lead,assignedToLabel:participants.find(p=>p.id===lead)?.label || null,coCooks:ids.filter(id=>id!==lead)}));
  }
  function dish(meal,day) {
    const days = activeMealDays(trip,meal), repeat = day !== days[0];
    const cooks = mealCooks(meal).map(canonical);
    const ready = (meal.readyBy || []).map(canonical).filter(id=>cooks.includes(id));
    const packed = ready.includes(canonical(userId));
    return <div className="meal-dish-wrap" key={meal.id}><details open className={`meal-dish${repeat?' meal-dish-repeat':''}`}>
      <summary><span>{meal.menuPending?'Menu to be decided':meal.name}</span>
        {!repeat && <span className="meal-dish-summary">{cooks.length?cooks.map(id=>participantDisplayName(trip,id,userId,meal.assignedToLabel)).join(' + '):'Needs a cook'}{days.length>1?` · ${mealDaysLabel(meal)}`:''}{cooks.length?` · ${ready.length}/${cooks.length} packed`:''}{meal.menuPending?' · Menu needed':''}</span>}
        {meal.needsHelp && <span className="meal-help-request">Helper requested</span>}
      </summary>
      <div className="meal-dish-details">
        {repeat && <p className="meal-help">Shared plan · {mealDaysLabel(meal)}</p>}
        <fieldset disabled={!canEdit} className="meal-cooks"><legend>Cooks · select one or more</legend>{participants.map(person=><label key={person.id}><input type="checkbox" checked={cooks.includes(canonical(person.id))} onChange={e=>chooseCooks(meal,e.target.checked?[...new Set([...cooks,canonical(person.id)])]:cooks.filter(id=>id!==canonical(person.id)))} />{person.label}</label>)}</fieldset>
        {meal.servings && <p className="meal-help">Feeds {meal.servings} people</p>}
        {(meal.ingredients || []).length>0 && <div><strong>Food to bring</strong><ul className="meal-ingredients">{meal.ingredients.map((ing,i)=><li key={`${ing.name}:${i}`}>{ing.name}{ing.qty?` · ${ing.qty}`:''}</li>)}</ul><p className="meal-help">{meal.quantityMode==='daily'?'These quantities are needed each shared day.':'These quantities cover all shared days as one batch.'}</p></div>}
        {meal.notes && <p>{meal.notes}</p>}
        {mine(meal) && <details><summary>Optional prep checks</summary><fieldset disabled={!canEdit} className="meal-prep"><legend>My share</legend>{[['purchasedBy','Food purchased'],['preppedBy','Prep done']].map(([stage,label])=><label key={stage}><input type="checkbox" checked={(meal[stage]||[]).some(id=>canonical(id)===canonical(userId))} onChange={e=>change(()=>confirmMealPrep(trip.id,meal.id,stage,e.target.checked))} />{label}</label>)}</fieldset></details>}
        {repeat && mine(meal) && canEdit && <button type="button" aria-pressed={packed} onClick={()=>change(()=>confirmMealPrep(trip.id,meal.id,'readyBy',!packed))}>{packed?'Packed ✓':'My food is packed'}</button>}
        {canEdit && <div className="meal-actions"><button type="button" onClick={()=>openMealEditor(meal,day)}>Edit name &amp; recipe</button>
          {!mine(meal) && <button type="button" onClick={()=>chooseCooks(meal,[...cooks,canonical(userId)])}>{cooks.length?'Join cooks':'I’ll take this'}</button>}
          {mine(meal) && <button type="button" onClick={()=>chooseCooks(meal,cooks.filter(id=>id!==canonical(userId)))}>Remove me</button>}
          <button type="button" onClick={()=>openTools({type:'bulk',action:'repeat',source:meal})}>Repeat meal</button>
          {cooks.length>0 && <button type="button" onClick={()=>openTools({type:'bulk',action:'assign',source:meal})}>Use these cooks elsewhere</button>}
        </div>}
        <MealCoordination trip={trip} meal={meal} canEdit={canEdit} onChange={change} />
      </div>
    </details>{!repeat && mine(meal) && canEdit && <button type="button" className="meal-packed" aria-pressed={packed} aria-label={`${packed?'Undo packed':'Mark my food packed'} for ${meal.name}`} onClick={()=>change(()=>confirmMealPrep(trip.id,meal.id,'readyBy',!packed))}>{packed?'Packed ✓':'My food is packed'}</button>}
      {canEdit&&<button type="button" className="meal-dish-delete" aria-label={`Delete ${meal.menuPending?'unplanned claimed meal':meal.name} on day ${day}`} onClick={()=>openTools({type:'delete',meal,day})}>Delete</button>}
    </div>;
  }
  return <section className="meal-schedule" aria-label="Daily meal schedule">
    <div className="meal-heading"><h2>Meals &amp; prep</h2>{canEdit && <button type="button" className="meal-primary" onClick={()=>onAdd(1,'dinner')}>+ Add meal</button>}</div>
    {(!trip.startDate || !trip.endDate) && <p className="meal-help">Set trip dates for an exact daily schedule.</p>}
    <div className="meal-filter-bar" aria-label="Filter meal schedule">{filters.map(([key,label])=><button type="button" key={key} aria-pressed={filter===key} onClick={()=>chooseFilter(key)}>{label} <span>{schedule.filter(p=>matches(p,key)).length}</span></button>)}</div>
    {canEdit && <div className="meal-toolbar"><button type="button" onClick={()=>openTools({type:'bulk',action:'assign'})}>Plan several meals</button><button type="button" onClick={()=>openTools({type:'window'})}>First &amp; last shared meal</button></div>}
    {shopping.changes.length>0 && onOpenShopping && <button type="button" className="meal-shopping-prompt" onClick={onOpenShopping}>Shopping has {shopping.changes.length} update{shopping.changes.length===1?'':'s'} to review</button>}
    {error && <p role="alert" className="meal-error">{error}</p>}
    {(notice || undo) && <div className="meal-save-feedback" role="status">{notice}{undo && <button type="button" onClick={()=>{if(change(()=>changeMealPeriods(trip.id,undo)))setUndo(null);}}>Undo</button>}</div>}
    {reminders.map(reminder=>{const meal=mealItems(trip).find(m=>m.id===reminder.mealId);return <div className="meal-notice" key={reminder.id}><span>Reminder: {meal.name}</span><button type="button" onClick={()=>onEdit(meal,activeMealDays(trip,meal)[0]||mealStartDay(meal))}>Open meal</button><button type="button" onClick={()=>change(()=>dismissMealReminder(trip.id,reminder.id))}>Dismiss</button></div>;})}
    {!groups.length && <p className="meal-help">{filter==='mine'?'No meals assigned to you. Open meals are ready for volunteers.':'No meals match this view.'}</p>}
    {groups.map(({day,periods})=><section className="meal-day" key={day} aria-label={mealDayOptionLabel(trip,day)}>
      <div className="meal-day-heading"><div><h3 id={`meal-day-heading-${day}`}>{mealDayOptionLabel(trip,day)}</h3><p className="meal-day-coverage">{periods.filter(p=>p.status==='open').length} open · {periods.filter(p=>p.status==='claimed').length} claimed</p></div>
      </div>
      <div className="meal-day-menu" aria-label={`Meals for ${mealDayOptionLabel(trip,day)}`}>
        {periods.map(period=>{
          const dishes=period.meals.filter(meal=>filter!=='mine'||mine(meal));
          const title=period.status==='on-your-own'?'On your own':dishes.map(meal=>meal.menuPending?'Menu to be decided':meal.name).join(', ')||'Open';
          return <div className={`meal-menu-row${period.status==='on-your-own'?' meal-menu-own':''}`} key={period.slot} role="group" aria-label={`${SLOT_LABEL[period.slot]} on day ${day}`}><span className="meal-menu-title"><span className="meal-menu-slot">{SLOT_LABEL[period.slot]}</span> — <span>{title}</span></span><button type="button" aria-label={`${canEdit?'Edit':'View'} ${SLOT_LABEL[period.slot]} on day ${day}`} onClick={()=>editPeriod(period)}>{canEdit?'Edit':'Details'}</button></div>;
        })}
      </div>
    </section>)}
    {periodDetails&&<Sheet title={SLOT_LABEL[periodDetails.slot]} subtitle={mealDayOptionLabel(trip,periodDetails.day)} onClose={closeTools}>
      <div className="meal-schedule meal-period-sheet"><div className="meal-period-heading"><span><SlotIcon slot={periodDetails.slot}/>{SLOT_LABEL[periodDetails.slot]}</span><span className={`meal-status ${periodDetails.status}`}>{STATUS_LABEL[periodDetails.status]}</span></div>
        {error&&<p role="alert" className="meal-error">{error}</p>}
        {periodDetails.status==='on-your-own'?<p className="meal-help">On your own</p>:<>
          {periodDetails.meals.filter(meal=>filter!=='mine'||mine(meal)).map(meal=>dish(meal,periodDetails.day))}
          {canEdit&&<div className="meal-actions">{!periodDetails.meals.length&&<><button type="button" className="meal-primary" onClick={()=>{if(change(()=>claimMealSlot(trip.id,periodDetails.day,periodDetails.slot)))closeTools();}}>I’ll take this</button><button type="button" onClick={()=>openNewMealEditor(periodDetails.day,periodDetails.slot)}>Plan meal</button></>}
            {periodDetails.meals.some(meal=>meal.menuPending)&&<button type="button" className="meal-primary" onClick={()=>openMealEditor(periodDetails.meals.find(meal=>meal.menuPending),periodDetails.day)}>Plan meal</button>}
            {periodDetails.meals.some(meal=>!meal.menuPending)&&<button type="button" onClick={()=>openNewMealEditor(periodDetails.day,periodDetails.slot,{newDish:true})}>+ Add a dish</button>}
            <button type="button" onClick={()=>{if(setOwn(periodDetails))closeTools();}}>On your own</button>
          </div>}
        </>}
      </div>
    </Sheet>}
    {tools?.type==='own' && <OwnMealEditor trip={trip} period={tools.period} onChange={change} onClose={closeTools} error={error} />}
    {tools?.type==='bulk' && <BulkMealTools trip={trip} participants={participants} initialAction={tools.action} sourceMeal={tools.source} onChange={change} onClose={closeTools} error={error} />}
    {tools?.type==='window' && <SharedMealSetup trip={trip} onChange={change} onClose={closeTools} error={error} />}
    {tools?.type==='delete' && <DeleteMealDialog trip={trip} meal={tools.meal} day={tools.day} onChange={change} onClose={closeTools} error={error} />}
  </section>;
}

import { useState } from 'react';
import { Sheet } from './MealPickers';
import { DAILY_MEAL_SLOTS, SLOT_LABEL, mealDayOptionLabel, normalizeMealSlot, mealStartDay, mealEndDay, mealDaysLabel } from '../lib/mealSlots';
import { buildMealSchedule, mealItems, mealPeriodKey, mealTeams, mealWindowChanges, mealComments } from '../lib/mealPlanning';
import { canonicalParticipantId, participantDisplayName } from '../lib/tripParticipants';
import { assignMealPeriods, changeMealPeriods, repeatMealToPeriods, copyMealPlan, getTrips, setSharedMealWindow,
  addMealComment, setMealReminder, updateMeal, getCurrentUserId, removeMealOccurrence } from '../lib/storage';

export function DeleteMealDialog({ trip, meal, day, onChange, onClose, error }) {
  const repeating=mealEndDay(meal)>mealStartDay(meal);
  const [scope,setScope]=useState(repeating?'day':'all');
  function remove() { if(onChange(()=>removeMealOccurrence(trip.id,meal.id,day,scope)))onClose(); }
  return <Sheet title="Delete meal?" subtitle={mealDayOptionLabel(trip,day)} onClose={onClose}
    footer={<button type="button" className="tr-mini-btn danger meal-sheet-save" onClick={remove}>Delete meal</button>}>
    <div className="meal-edit-fields">{error&&<p className="meal-error" role="alert">{error}</p>}
      <p>{meal.menuPending?'Delete this unplanned claimed meal?':`Delete “${meal.name}”?`}</p>
      {repeating&&<label className="meal-field">Delete from<select value={scope} onChange={e=>setScope(e.target.value)}><option value="day">Only {mealDayOptionLabel(trip,day)}</option><option value="all">All covered days · {mealDaysLabel(meal)}</option></select></label>}
      <p className="meal-help">Other dishes in this meal period stay in the plan.</p>
    </div>
  </Sheet>;
}

export function OwnMealEditor({ trip, period, onChange, onClose, error }) {
  const [mode, setMode] = useState('on-your-own');
  const [reason, setReason] = useState(period.settings?.reason || '');
  function save() {
    const choice={day:period.day,slot:period.slot};
    if(mode!==(period.settings?.mode||'on-your-own'))choice.mode=mode;
    if(reason!==(period.settings?.reason||''))choice.reason=reason;
    if(Object.keys(choice).length===2){onClose();return;}
    if (onChange(() => changeMealPeriods(trip.id, [choice]))) onClose();
  }
  return <Sheet title="Edit meal plan" subtitle={`${mealDayOptionLabel(trip, period.day)} · ${SLOT_LABEL[period.slot]}`} onClose={onClose}
    footer={<button type="button" className="tr-mini-btn primary meal-sheet-save" onClick={save}>Save</button>}>
    <div className="meal-edit-fields">{error&&<p className="meal-error" role="alert">{error}</p>}<label className="meal-field">Plan<select value={mode} onChange={e => setMode(e.target.value)}>
      <option value="on-your-own">On your own</option><option value="shared">Shared meal</option></select></label>
      <details><summary>Optional note</summary><label className="meal-field">Note<input value={reason} onChange={e => setReason(e.target.value)} placeholder="Arriving in the evening" /></label></details>
    </div>
  </Sheet>;
}

export function BulkMealTools({ trip, participants, initialAction = 'assign', sourceMeal = null, onChange, onClose, error }) {
  const [action, setAction] = useState(initialAction);
  const [selected, setSelected] = useState([]);
  const [cooks, setCooks] = useState(sourceMeal ? [sourceMeal.assignedTo, ...(sourceMeal.coCooks || [])].filter(Boolean).map(id => canonicalParticipantId(trip, id) || id) : []);
  const [teamName, setTeamName] = useState('');
  const [sourceId, setSourceId] = useState(sourceMeal?.id || mealItems(trip)[0]?.id || '');
  const [sourceTripId, setSourceTripId] = useState('');
  const [useCooks, setUseCooks] = useState(true);
  const [quantityMode, setQuantityMode] = useState('batch');
  const schedule = buildMealSchedule(trip);
  const periods = schedule.filter(p => selected.includes(mealPeriodKey(p)));
  const teams = mealTeams(trip);
  const previousTrips = getTrips().filter(t => t.id !== trip.id && mealItems(t).some(m => !m.menuPending));
  const days = [...new Set(schedule.map(p => p.day))];
  function toggle(keys, checked) { setSelected(current => checked ? [...new Set([...current, ...keys])] : current.filter(key => !keys.includes(key))); }
  function apply() {
    const saved = onChange(() => {
      if (action === 'assign') return assignMealPeriods(trip.id, periods, cooks, { teamName });
      if (action === 'repeat') return repeatMealToPeriods(trip.id, sourceId, periods, { useCooks, quantityMode });
      if (action === 'copy') return copyMealPlan(trip.id, sourceTripId);
      return changeMealPeriods(trip.id, periods.map(({ day, slot }) => ({ day, slot, mode: action === 'own' ? 'on-your-own' : 'shared' })));
    });
    if (saved) onClose();
  }
  const invalid = action === 'copy' ? !sourceTripId : !periods.length || (action === 'assign' && !cooks.length) || (action === 'repeat' && !sourceId);
  return <Sheet title="Plan several meals" onClose={onClose} footer={<button type="button" className="tr-mini-btn primary meal-sheet-save" disabled={invalid} onClick={apply}>{action === 'copy' ? 'Copy into empty meal periods' : `Apply to ${periods.length} meal${periods.length === 1 ? '' : 's'}`}</button>}>
    <div className="meal-edit-fields">
      {error&&<p className="meal-error" role="alert">{error}</p>}
      <label className="meal-field">Action<select value={action} onChange={e => { setAction(e.target.value); setSelected([]); }}>
        <option value="assign">Assign cooks</option><option value="own">On your own</option><option value="shared">Reopen shared meals</option><option value="repeat">Repeat a meal</option><option value="copy">Copy from another trip</option>
      </select></label>
      {action === 'copy' ? <><label className="meal-field">Previous trip<select value={sourceTripId} onChange={e => setSourceTripId(e.target.value)}><option value="">Choose a trip</option>{previousTrips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><p className="meal-help">Copies menus into empty periods within this trip’s dates. Choose cooks after copying.</p></> : <>
        {action === 'assign' && <>
          {teams.length > 0 && <label className="meal-field">Saved cooking group<select defaultValue="" onChange={e => { const team = teams.find(t => t.id === e.target.value); if (team) setCooks(team.cookIds.map(id => canonicalParticipantId(trip, id) || id).filter(id => participants.some(p => p.id === id))); }}><option value="">Choose a group</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
          <fieldset className="meal-cooks"><legend>Cooks</legend>{participants.map(p => <label key={p.id}><input type="checkbox" checked={cooks.includes(p.id)} onChange={e => setCooks(e.target.checked ? [...cooks,p.id] : cooks.filter(id => id !== p.id))} />{p.label}</label>)}</fieldset>
          <label className="meal-field">Save this group as (optional)<input value={teamName} onChange={e => setTeamName(e.target.value)} placeholder="Breakfast crew" /></label>
          <p className="meal-help">Applies these cooks to every dish in the selected periods. Selected on-your-own periods become shared. Select all covered days of a repeating dish to change its cooks together.</p>
        </>}
        {action === 'repeat' && <><label className="meal-field">Meal<select value={sourceId} onChange={e => setSourceId(e.target.value)}>{mealItems(trip).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label className="meal-choice"><input type="checkbox" checked={useCooks} onChange={e => setUseCooks(e.target.checked)} />Use the same cooks</label>
          <label className="meal-field">Food quantities for the new days<select value={quantityMode} onChange={e => setQuantityMode(e.target.value)}><option value="batch">One new batch per meal period</option><option value="daily">This amount each selected day</option></select></label>
        </>}
        <div className="meal-period-picker" aria-label="Choose meal periods">{days.map(day => {
          const dayPeriods = schedule.filter(p => p.day === day && (action !== 'repeat' || !p.meals.length));
          const keys = dayPeriods.map(mealPeriodKey);
          if (!keys.length) return null;
          return <details key={day} open={day === 1}><summary>{mealDayOptionLabel(trip, day)} · {keys.filter(key => selected.includes(key)).length} selected</summary>
            <label className="meal-choice"><input type="checkbox" checked={keys.every(key => selected.includes(key))} onChange={e => toggle(keys, e.target.checked)} />Select this day</label>
            <div className="meal-cooks">{dayPeriods.map(p => <label key={p.slot}><input type="checkbox" checked={selected.includes(mealPeriodKey(p))} onChange={e => toggle([mealPeriodKey(p)], e.target.checked)} />{SLOT_LABEL[p.slot]}{p.status==='on-your-own'?' · On your own':''}</label>)}</div>
          </details>;
        })}</div>
        {periods.length>0 && <details><summary>Review {periods.length} selected meal periods</summary><ul className="meal-ingredients">{periods.map(p=><li key={mealPeriodKey(p)}>{mealDayOptionLabel(trip,p.day)} · {SLOT_LABEL[p.slot]} · {p.meals.length?p.meals.map(m=>m.name).join(', '):p.status==='on-your-own'?'On your own':'Open'}</li>)}</ul></details>}
      </>}
    </div>
  </Sheet>;
}

export function SharedMealSetup({ trip, onChange, onClose, error: saveError }) {
  const days = [...new Set(buildMealSchedule(trip).map(p => p.day))];
  const previous = (trip.meals || []).find(m => m.kind === 'meal-window');
  const [first, setFirst] = useState(previous?.first ? {...previous.first,slot:normalizeMealSlot(previous.first.slot)} : { day: 1, slot: 'dinner' });
  const [last, setLast] = useState(previous?.last ? {...previous.last,slot:normalizeMealSlot(previous.last.slot)} : { day: days.at(-1), slot: days.length === 1 ? 'dessert' : 'breakfast' });
  let preview = [], error = '';
  try { preview = mealWindowChanges(trip, first, last); } catch (e) { error = e.message; }
  const ownPeriods = preview.filter(p => p.mode === 'on-your-own');
  const boundary = (label, value, set) => <fieldset className="meal-boundary"><legend>{label}</legend><label className="meal-field">Day<select value={value.day} onChange={e => set({ ...value, day: Number(e.target.value) })}>{days.map(day => <option key={day} value={day}>{mealDayOptionLabel(trip,day)}</option>)}</select></label><label className="meal-field">Meal<select value={value.slot} onChange={e => set({ ...value, slot: e.target.value })}>{DAILY_MEAL_SLOTS.map(slot => <option key={slot} value={slot}>{SLOT_LABEL[slot]}</option>)}</select></label></fieldset>;
  return <Sheet title="First & last shared meal" onClose={onClose} footer={<button type="button" className="tr-mini-btn primary meal-sheet-save" disabled={!!error} onClick={() => { if (onChange(() => setSharedMealWindow(trip.id,first,last))) onClose(); }}>Apply meal times</button>}>
    <div className="meal-edit-fields">{saveError&&<p className="meal-error" role="alert">{saveError}</p>}{boundary('First shared meal',first,setFirst)}{boundary('Last shared meal',last,setLast)}
      {error ? <p role="alert" className="meal-error">{error}</p> : <details><summary>{ownPeriods.length} meal periods will be on your own</summary><ul className="meal-ingredients">{ownPeriods.map(p => <li key={mealPeriodKey(p)}>{mealDayOptionLabel(trip,p.day)} · {SLOT_LABEL[p.slot]}</li>)}</ul></details>}
    </div>
  </Sheet>;
}

export function MealCoordination({ trip, meal, canEdit, onChange }) {
  const [text,setText] = useState('');
  const [notice,setNotice] = useState('');
  const uid = getCurrentUserId();
  const comments = mealComments(trip,meal.id);
  return <div className="meal-coordination">
    {canEdit && <div className="meal-actions"><button type="button" aria-pressed={Boolean(meal.needsHelp)} onClick={() => onChange(() => updateMeal(trip.id,meal.id,{ needsHelp: !meal.needsHelp }))}>{meal.needsHelp ? 'Helper requested · Clear' : 'Need a helper'}</button>
      <button type="button" onClick={() => { if (onChange(() => setMealReminder(trip.id,meal.id,Date.now()+86400000))) setNotice('In-app reminder set for tomorrow. Open Meals to see it.'); }}>Remind me tomorrow</button></div>}
    {notice && <p className="meal-help" role="status">{notice}</p>}
    <details className="meal-discussion"><summary>Discussion ({comments.length})</summary>
      {comments.map(comment => <div className="meal-comment" key={comment.id}><strong>{participantDisplayName(trip,comment.authorId,uid)}</strong><p>{comment.text}</p></div>)}
      {canEdit && <form onSubmit={e => { e.preventDefault(); if (text.trim() && onChange(() => addMealComment(trip.id,meal.id,text))) setText(''); }}>
        <label className="meal-field">Message<textarea maxLength={2000} value={text} onChange={e => setText(e.target.value)} placeholder="Can someone bring the tortillas?" /></label><button type="submit" disabled={!text.trim()}>Post</button>
      </form>}
    </details>
  </div>;
}

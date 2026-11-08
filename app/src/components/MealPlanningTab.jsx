import { useCallback, useEffect, useMemo, useState } from 'react';
import { MealSchedule } from './MealSchedule';
import { Sheet, IngredientField, SavedMealSheet } from './MealPickers';
import { getTrip, getTrips, planMeal, removeMealOccurrence, saveMealOccurrence } from '../lib/storage';
import { savePlanningLocally } from '../lib/planningSave';
import { canonicalParticipantId } from '../lib/tripParticipants';
import { MEAL_SLOTS, SLOT_LABEL, mealCoversDay, mealDayOptionLabel, mealStartDay, mealEndDay, tripDayCount, normalizeMealSlot, sameMealSlot } from '../lib/mealSlots';
import { mealCooks, mealDraftChanges, mealItems } from '../lib/mealPlanning';
import { cleanIngredients, listSavedMeals, listSavedIngredients, publishSavedMeal, rememberMeal, refreshSharedMeals, updateSavedMeal, removeSavedMeal } from '../lib/mealLibrary';

export function MealPlanningTab({ trip, participants, onTripUpdate, onOpenShopping }) {
  const [editor, setEditor] = useState(null);
  const [message, setMessage] = useState('');
  const closeEditor = useCallback(() => setEditor(null), []);
  function commit(saveLocal) {
    setMessage('');
    return savePlanningLocally(trip.id, saveLocal, { onSaved: onTripUpdate, onSynced: onTripUpdate,
      onError: error => setMessage(`Saved on this device. ${error.message || 'Sync will retry.'}`) });
  }
  return <>
    {message && <p className="meal-error" role="status">{message}</p>}
    <MealSchedule trip={trip} participants={participants} onTripUpdate={onTripUpdate} onOpenShopping={onOpenShopping}
      onAdd={(day, slot, {newDish=false}={}) => {
        const pending=!newDish&&mealItems(getTrip(trip.id)||trip).find(meal=>meal.menuPending&&sameMealSlot(meal.slot,slot)&&mealCoversDay(meal,day));
        setEditor({ meal:pending||undefined, day, slot, newDish });
      }}
      onEdit={(meal, day) => setEditor({ meal, day, slot: normalizeMealSlot(meal.slot) })} />
    {editor && <MealEditor key={`${editor.meal?.id || 'new'}:${editor.day}:${editor.slot}`} trip={trip} participants={participants}
      context={editor} onCommit={commit} onClose={closeEditor} />}
  </>;
}

export function MealEditor({ trip, participants, context, onCommit, onClose }) {
  const meal = context.meal;
  const [name, setName] = useState(meal?.menuPending ? '' : meal?.name || '');
  const [day, setDay] = useState(meal ? mealStartDay(meal) : context.day);
  const [endDay, setEndDay] = useState(meal ? mealEndDay(meal) : context.day);
  const [slot, setSlot] = useState(normalizeMealSlot(context.slot));
  const [scope, setScope] = useState('all');
  const [cooks, setCooks] = useState(meal ? mealCooks(meal).map(id => canonicalParticipantId(trip,id) || id) : []);
  const [servings, setServings] = useState(meal ? meal.servings || '' : participants.length || '');
  const [ingredients, setIngredients] = useState(meal?.ingredients || []);
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState(meal?.notes || '');
  const [quantityMode, setQuantityMode] = useState(meal?.quantityMode || 'batch');
  const [initialDraft] = useState(() => ({ name:name.trim(), dayIndex:day, endDayIndex:endDay>day?endDay:null, slot,
    assignedTo:cooks[0]||null,assignedToLabel:participants.find(p=>p.id===cooks[0])?.label||null,coCooks:cooks.slice(1),
    servings:Number(servings)>0?Number(servings):null,ingredients:cleanIngredients(ingredients),notes:notes.trim(),quantityMode,menuPending:Boolean(meal?.menuPending) }));
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [, setLibraryTick] = useState(0);
  const [error, setError] = useState('');
  const localTrips = useMemo(() => getTrips(), []);
  const savedMeals = listSavedMeals(localTrips);
  const ingredientLibrary = listSavedIngredients(localTrips);
  const days = Array.from({ length: Math.min(366, Math.max(tripDayCount(trip), meal ? mealEndDay(meal) : context.day)) }, (_,i) => i+1);
  const repeating = meal && mealEndDay(meal) > mealStartDay(meal);
  useEffect(() => {
    let active = true;
    void refreshSharedMeals().then(() => { if (active) setLibraryTick(n => n+1); });
    return () => { active = false; };
  }, []);
  function pick(saved) { setName(saved.name); setIngredients(cleanIngredients(saved.ingredients)); setLibraryOpen(false); }
  function save() {
    if (!name.trim()) { setError('Name this meal or choose a saved recipe.'); return; }
    const incoming = draft.split(',').map(text => text.trim()).filter(Boolean).map(name => ({ name, qty: '' }));
    const firstDay = scope === 'day' ? context.day : Number(day);
    const lastDay = scope === 'day' ? context.day : Math.max(firstDay, Number(endDay));
    const payload = { name: name.trim(), dayIndex: firstDay, endDayIndex: lastDay > firstDay ? lastDay : null, slot,
      assignedTo: cooks[0] || null, assignedToLabel: participants.find(p => p.id === cooks[0])?.label || null,
      coCooks: cooks.slice(1), servings: Number(servings) > 0 ? Number(servings) : null,
      ingredients: cleanIngredients([...ingredients,...incoming]), notes: notes.trim(), quantityMode, menuPending: false };
    try {
      const changes = meal ? mealDraftChanges(initialDraft,payload,scope) : payload;
      if (meal && !Object.keys(changes).length) { onClose(); return; }
      const preserveClaim=JSON.stringify(cooks)===JSON.stringify([initialDraft.assignedTo,...initialDraft.coCooks].filter(Boolean));
      const saved = onCommit(() => meal ? saveMealOccurrence(trip.id,meal.id,context.day,changes,scope) : planMeal(trip.id,{ ...payload,reopenPeriods:true },{newDish:context.newDish,preserveClaim}));
      onClose();
      const recipe = saved?.name ? saved : payload;
      try { rememberMeal(recipe); } catch { /* The meal itself is already saved. */ }
      void publishSavedMeal(recipe).catch(() => {});
    } catch (e) { setError(e.message || 'Could not save this meal.'); }
  }
  function remove() {
    const label=meal.menuPending?'this unplanned claimed meal':`“${meal.name}”`;
    const days=scope==='day'?mealDayOptionLabel(trip,context.day):'all covered days';
    if (!window.confirm(`Delete ${label} from ${days}?`)) return;
    try { onCommit(() => removeMealOccurrence(trip.id,meal.id,context.day,scope)); onClose(); } catch(e) { setError(e.message); }
  }
  if (libraryOpen) return <SavedMealSheet savedMeals={savedMeals} selectedKey={name.trim().toLowerCase()} onPick={pick}
    onClose={() => setLibraryOpen(false)} onDelete={saved => { if (window.confirm(`Remove "${saved.name}" from saved meals?`)) { removeSavedMeal(saved.nameKey); setLibraryTick(n=>n+1); } }}
    onSaveEdit={(key, patch) => {
      const previous = savedMeals.find(m => m.nameKey === key);
      const updated = updateSavedMeal(key,{ name:patch.name,slot:patch.slot,ingredients:patch.ingredients.map(name => ({ name,qty:previous?.ingredients.find(i=>i.name.toLowerCase()===name.toLowerCase())?.qty||'' })) });
      if (updated) void publishSavedMeal(updated).catch(()=>{});
      setLibraryTick(n=>n+1);
    }} />;
  return <Sheet title={slot === 'happy-hour' ? (meal ? 'Edit happy hour item' : 'Plan happy hour') : (meal ? 'Edit meal' : 'Plan a meal')} subtitle={`${mealDayOptionLabel(trip,context.day)} · ${SLOT_LABEL[normalizeMealSlot(context.slot)]}`} onClose={onClose}
    footer={<div className="meal-editor-footer">{meal&&<button type="button" className="tr-mini-btn danger" onClick={remove}>Delete meal</button>}<button type="submit" form="meal-editor-form" className="tr-mini-btn primary">Save meal</button></div>}>
    <form id="meal-editor-form" className="meal-edit-fields" onSubmit={e=>{e.preventDefault();save();}}>
      {error && <p className="meal-error" role="alert">{error}</p>}
      <label className="meal-field">{slot === 'happy-hour' ? 'What are you preparing for happy hour?' : 'Meal name'}<input value={name} onChange={e=>setName(e.target.value)} placeholder={slot === 'happy-hour' ? 'Cheese & crackers, appetizers, drinks…' : 'Chili, tacos, oatmeal…'} /></label>
      {savedMeals.length > 0 && <div><p className="meal-help">Recent meals</p><div className="meal-actions">{savedMeals.slice(0,3).map(saved=><button type="button" key={saved.nameKey} onClick={()=>pick(saved)}>{saved.name}</button>)}<button type="button" onClick={()=>setLibraryOpen(true)}>Browse saved meals ({savedMeals.length})</button></div></div>}
      <fieldset className="meal-cooks"><legend>Cooks · choose one or more</legend>{participants.map(person=><label key={person.id}><input type="checkbox" checked={cooks.includes(person.id)} onChange={e=>setCooks(e.target.checked?[...cooks,person.id]:cooks.filter(id=>id!==person.id))} />{person.label}</label>)}</fieldset>
      {repeating && <label className="meal-field">Apply changes to<select value={scope} onChange={e=>setScope(e.target.value)}><option value="all">All covered days</option><option value="day">Only {mealDayOptionLabel(trip,context.day)}</option></select></label>}
      <details className="meal-editor-more"><summary>Dates, servings &amp; prep details</summary><div className="meal-edit-fields">
        <div className="meal-boundary"><label className="meal-field">First day<select disabled={scope==='day'} value={scope==='day'?context.day:day} onChange={e=>{setDay(Number(e.target.value));setEndDay(current=>Math.max(current,Number(e.target.value)));}}>{days.map(d=><option key={d} value={d}>{mealDayOptionLabel(trip,d)}</option>)}</select></label>
          <label className="meal-field">Last day<select disabled={scope==='day'} value={scope==='day'?context.day:endDay} onChange={e=>setEndDay(Number(e.target.value))}>{days.filter(d=>d>=(scope==='day'?context.day:day)).map(d=><option key={d} value={d}>{mealDayOptionLabel(trip,d)}</option>)}</select></label></div>
        <label className="meal-field">Meal period<select value={slot} onChange={e=>setSlot(e.target.value)}>{MEAL_SLOTS.map(id=><option key={id} value={id}>{SLOT_LABEL[id]}</option>)}</select></label>
        <label className="meal-field">People eating<input type="number" min="1" value={servings} onChange={e=>setServings(e.target.value)} /></label>
        <IngredientField selected={ingredients.map(ing=>ing.name)} library={ingredientLibrary} draft={draft} onDraftChange={setDraft}
          onChange={names=>setIngredients(names.map(name=>ingredients.find(ing=>ing.name===name)||{name,qty:''}))} />
        {ingredients.length>0 && <><label className="meal-field">Quantities cover<select value={quantityMode} onChange={e=>setQuantityMode(e.target.value)}><option value="batch">One batch for all shared days</option><option value="daily">This amount each shared day</option></select></label>
          {ingredients.map((ing,index)=><label className="meal-field" key={ing.name}>{ing.name}<input value={ing.qty||''} onChange={e=>setIngredients(current=>current.map((item,i)=>i===index?{...item,qty:e.target.value}:item))} placeholder="Quantity, e.g. 2 cans" /></label>)}</>}
        <label className="meal-field">Prep notes or dietary information<textarea value={notes} onChange={e=>setNotes(e.target.value)} /></label>
      </div></details>
    </form>
  </Sheet>;
}

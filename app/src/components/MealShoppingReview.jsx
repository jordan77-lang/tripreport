import { useState } from 'react';
import { Sheet } from './MealPickers';
import { mealItems, mealShoppingChanges } from '../lib/mealPlanning';
import { generateShoppingList } from '../lib/storage';

export function MealShoppingReview({ trip, onChange, onClose, error }) {
  const [review,setReview] = useState(()=>mealShoppingChanges(trip));
  const stale = mealShoppingChanges(trip).revision !== review.revision;
  const names = ids => (ids||[]).map(id=>mealItems(trip).find(m=>m.id===id)?.name).filter(Boolean).join(', ');
  function apply() { if(onChange(()=>generateShoppingList(trip.id,review.revision)))onClose(); }
  return <Sheet title="Review shopping updates" onClose={onClose} footer={<button type="button" className="tr-mini-btn primary meal-sheet-save" disabled={stale || !review.changes.length} onClick={apply}>Apply {review.changes.length} update{review.changes.length===1?'':'s'}</button>}>
    <div className="meal-edit-fields">
      {error&&<p className="meal-error" role="alert">{error}</p>}
      {stale && <div role="alert"><p>The meal plan or shopping list changed.</p><button type="button" onClick={()=>setReview(mealShoppingChanges(trip))}>Refresh review</button></div>}
      {review.changes.map((change,i)=><div className="meal-shopping-change" key={`${change.id||change.row.name}:${i}`}><strong>{change.type==='add'?'Add':change.type==='remove'?'Remove':'Update'}: {change.row.name}</strong>
        <p>{change.type==='update'?`${change.previousQty||'No quantity'} → ${change.row.qty||'Confirm quantity'}`:change.row.qty||'Confirm quantity'}</p>
        {change.type!=='remove' && <p className="meal-help">For: {names(change.row.sourceMealIds)}</p>}
      </div>)}
      {!review.changes.length && <p>Shopping is up to date with the meal plan.</p>}
      {review.protectedItems.length>0 && <div><h3>Quantities to check</h3><p className="meal-help">Manual, edited, and purchased items keep their current quantities.</p>{review.protectedItems.map(item=><p key={item.id}>{item.name}: list {item.currentQty||'not set'} · meals need {item.plannedQty||'a quantity'}</p>)}</div>}
    </div>
  </Sheet>;
}

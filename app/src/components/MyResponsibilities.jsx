import { getCurrentUserId, confirmMyGearReady, confirmAllGearReady, confirmMyMealReady } from '../lib/storage';
import { gearAssigneeIds, gearResponsibilityLabel, getMyResponsibilities, isGearFullyReady, isPersonReady, mealResponsibilityLabel } from '../lib/tripDashboard';
import { savePlanningToCloud } from '../lib/planningSave';
import { money } from '../lib/expenses';
import { ReminderFinger } from './ReminderFinger';
import { T } from '../tokens';
import gearImg from '../assets/gear.png';
import mealImg from '../assets/meal.png';
import cartImg from '../assets/cart.png';
import expenseImg from '../assets/expense.png';
import readyImg from '../assets/ready.png';

export function MyResponsibilities({ trip, onOpenPlan, onTripUpdate }) {
  const currentUserId = getCurrentUserId();
  const tasks = getMyResponsibilities(trip, currentUserId);
  const completed = trip?.status === 'completed';

  function confirmGear(item) {
    const next = !isPersonReady(item, currentUserId, trip);
    void savePlanningToCloud(trip.id, () => {
      confirmMyGearReady(trip.id, item.id, next);
    }).then(() => onTripUpdate?.());
  }

  function confirmAllGear(item) {
    const next = !isGearFullyReady(item, trip);
    void savePlanningToCloud(trip.id, () => {
      confirmAllGearReady(trip.id, item.id, next);
    }).then(() => onTripUpdate?.());
  }

  function confirmMeal(item) {
    const next = !isPersonReady(item, currentUserId, trip);
    void savePlanningToCloud(trip.id, () => {
      confirmMyMealReady(trip.id, item.id, next);
    }).then(() => onTripUpdate?.());
  }

  return (
    <section className="responsibilities" aria-labelledby="my-responsibilities-title">
      <div className="dashboard-section-heading">
        <div>
          <p className="dashboard-eyebrow">Your part of the adventure</p>
          <h2 id="my-responsibilities-title">My responsibilities</h2>
        </div>
        <ReminderFinger size={40} />
      </div>
      <p className="dashboard-description">{completed ? 'Review what you brought, cooked, and spent.' : 'Confirm your own share. On shared gear you can also mark the whole item when all of it is ready.'}</p>
      <div className="responsibility-grid">
        <ResponsibilityGroup title="Gear to bring" icon={gearImg} action="Open gear list" onOpen={() => onOpenPlan('gear')}
          empty="No gear assigned to you yet."
          onConfirm={completed ? null : confirmGear}
          onConfirmAll={completed ? null : confirmAllGear}
          items={tasks.gear.map(item => ({ id: item.id, source: item, title: item.name, detail: gearResponsibilityLabel(item, trip, currentUserId), done: isPersonReady(item, currentUserId, trip), shared: gearAssigneeIds(item, trip).length > 1, allReady: isGearFullyReady(item, trip) }))} />
        <ResponsibilityGroup title="Your meals" icon={mealImg} action="Open meal plan" onOpen={() => onOpenPlan('meals')}
          empty="No meals assigned to you yet."
          onConfirm={completed ? null : confirmMeal}
          items={tasks.meals.map(item => ({ id: item.id, source: item, title: item.name, detail: `${mealResponsibilityLabel(item, trip.startDate)} · ${isPersonReady(item, currentUserId, trip) ? 'You ready' : 'To prep'}`, done: isPersonReady(item, currentUserId, trip) }))} />
        <ResponsibilityGroup title="Shopping you added" icon={cartImg} action="Open shopping list" onOpen={() => onOpenPlan('shopping')}
          empty="You haven't added any shopping items." items={tasks.shopping.map(item => ({ id: item.id, title: item.name, detail: item.checked ? 'Purchased' : item.qty || 'To buy', done: item.checked }))}>
          <p className="dashboard-caption">These are items you added; the shopping list is shared by the crew.</p>
        </ResponsibilityGroup>
        <div className="responsibility-group">
          <div className="responsibility-group-title"><img src={expenseImg} alt="" aria-hidden="true" width={30} height={30} /><h3>Your trip balance</h3></div>
          <p className="responsibility-balance">{money(Math.abs(tasks.balance))}</p>
          <p className="dashboard-description">{!tasks.hasExpenses ? 'No expenses recorded yet.' : tasks.balance < -0.01 ? 'Your share to pay, based on recorded expenses.' : tasks.balance > 0.01 ? 'Your crew owes you, based on recorded expenses.' : 'Your recorded costs are balanced.'}</p>
          <button className="dashboard-text-button" type="button" onClick={() => onOpenPlan('expenses')}>Review trip expenses <span aria-hidden="true">{'\u2192'}</span></button>
        </div>
      </div>
      {!completed && (tasks.unassignedGear > 0 || tasks.unassignedMeals > 0) && (
        <div className="dashboard-help">
          <div><h3>Give the crew a hand</h3><p>{tasks.unassignedGear} gear item{tasks.unassignedGear === 1 ? '' : 's'} and {tasks.unassignedMeals} meal{tasks.unassignedMeals === 1 ? '' : 's'} still need someone.</p></div>
          <button className="dashboard-button secondary" type="button" onClick={() => onOpenPlan(tasks.unassignedGear ? 'gear' : 'meals')}>Find a task</button>
        </div>
      )}
    </section>
  );
}

function ResponsibilityGroup({ title, icon, items, empty, action, onOpen, onConfirm, onConfirmAll, children }) {
  return <div className="responsibility-group">
    <div className="responsibility-group-title"><img src={icon} alt="" aria-hidden="true" width={30} height={30} /><h3>{title}</h3></div>
    {items.length ? <ul className="responsibility-list">{items.map(item => <li key={item.id}>
      <img className={`responsibility-marker${item.done ? ' done' : ''}`} src={item.done ? readyImg : icon} alt="" aria-hidden="true" width={28} height={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p>{item.title}</p>
        <span>{item.detail}</span>
        {onConfirm && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="dashboard-text-button" aria-pressed={Boolean(item.done)} onClick={() => onConfirm(item.source)} style={{ minHeight: 32, padding: '2px 0' }}>
              {item.shared ? (item.done ? 'Undo my share' : 'My share') : (item.done ? 'Undo my ready' : 'I have this')}
            </button>
            {onConfirmAll && item.shared && (
              <button type="button" className="dashboard-text-button" aria-pressed={Boolean(item.allReady)} onClick={() => onConfirmAll(item.source)} style={{ minHeight: 32, padding: '2px 0' }}>
                {item.allReady ? 'Undo all' : 'All of it'}
              </button>
            )}
          </div>
        )}
      </div>
    </li>)}</ul> : <p className="dashboard-description">{empty}</p>}
    {children}
    <button className="dashboard-text-button" type="button" onClick={onOpen}>{action} <span aria-hidden="true">{'\u2192'}</span></button>
  </div>;
}

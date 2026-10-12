import { useState } from 'react';
import { CaptureActions } from '../components/CaptureActions';
import { AddExpenseSheet } from '../components/AddExpenseSheet';
import { EntryForm } from './EntryForm';
import { addEntry, getCurrentUserId, isTripMember, isTripOpen } from '../lib/storage';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';

export function QuickCapture({ trip, initialType = null, locationId = null, eventId = null, onCancel, onSaved }) {
  const [type, setType] = useState(initialType);
  const [error, setError] = useState(null);
  const event = (trip?.events || []).find(e => e.id === eventId) || null;
  const location = (trip?.locations || []).find(l => l.id === (event?.locationId || locationId)) || null;
  const canCapture = isTripOpen(trip) && isTripMember(trip, getCurrentUserId());

  function save(entry) {
    setError(null);
    try {
      if (!canCapture) throw new Error('Select an open trip you belong to before logging.');
      const saved = addEntry(trip.id, { ...entry, eventId: event?.id });
      if (!saved) throw new Error('This trip is no longer available. Your entry has not been saved.');
      onSaved('Entry saved on this phone.');
    } catch (e) {
      setError(e.message || 'Could not save. Please try again.');
    }
  }

  if (canCapture && type && type !== 'expense') {
    return <EntryForm type={type} trip={trip} event={event} locations={event && location ? [location] : trip.locations || []}
      defaultLocationId={location?.id || null} allowUnlinked={!event}
      saveError={error} onSave={save} onCancel={onCancel} />;
  }

  return <div style={{ height: '100%', overflowY: 'auto', background: T.bg, fontFamily: F, padding: 20 }}>
    <button type="button" onClick={onCancel} style={{ minHeight: 44, padding: '8px 12px', border: '1px solid ' + T.border,
      borderRadius: 10, background: T.card, color: T.text, fontSize: ts(14), cursor: 'pointer' }}>← Back</button>
    <h1 style={{ fontSize: ts(24), marginTop: 20, color: T.text }}>Log a moment</h1>
    <p style={{ fontSize: ts(16), color: T.textSub, lineHeight: 1.5, margin: '8px 0 20px' }}>
      {trip?.name || 'No trip selected'}{location ? ' · ' + location.name : ''}
    </p>
    {canCapture ? <>
      <CaptureActions trip={trip} onCapture={setType} />
      <p style={{ fontSize: ts(14), color: T.textSub, lineHeight: 1.5, marginTop: 16 }}>
        Save now, organize later. A saved location is optional. Entries stay on this phone when you are offline.
      </p>
      {type === 'expense' && <AddExpenseSheet trip={trip} location={location} event={event}
        onClose={() => setType(null)} onSaved={() => onSaved('Expense saved on this phone. Find it in Plan → Expenses.')} />}
    </> : <p style={{ color: T.textSub }}>Choose an open trip you belong to before adding a moment.</p>}
  </div>;
}

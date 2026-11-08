import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ic } from './Ic';
import { SlotIcon } from './SlotIcon';
import { ICONS } from '../tokens';
import { MEAL_SLOTS, SLOT_LABEL, normalizeMealSlot } from '../lib/mealSlots';
import {
  INGREDIENT_CATEGORIES,
  classifyIngredientCategory,
  getIngredientCategoryMeta,
  sortIngredients,
} from '../lib/mealLibrary';

const CHECK_PATH = 'M20 6L9 17l-5-5';
const keyOf = (name) => String(name || '').trim().toLowerCase();

function splitNames(raw) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const name = part.trim();
    const key = keyOf(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Library names that match a typed query: prefix matches first, then anywhere in the name. */
function matchIngredients(library, query, excludeKeys, limit = 6) {
  const q = keyOf(query);
  if (!q) return [];
  const starts = [];
  const contains = [];
  for (const name of library) {
    const key = keyOf(name);
    if (excludeKeys.has(key)) continue;
    if (key.startsWith(q) || key.split(/\s+/).some((word) => word.startsWith(q))) starts.push(name);
    else if (key.includes(q)) contains.push(name);
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * Bottom sheet shell that matches the app (cream body, white header and footer).
 * Rendered in a portal so a scrolling or transformed parent cannot clip it.
 */
export function Sheet({ title, subtitle, label, onClose, headerAction, toolbar, footer, children }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    const first = dialogRef.current?.querySelector('[data-autofocus]') || dialogRef.current?.querySelector('button, input');
    // Do not pop the keyboard open on phones; only focus the search field on wide screens.
    if (first && (first.tagName !== 'INPUT' || window.matchMedia('(min-width: 769px)').matches)) first.focus();

    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
      if (e.key === 'Tab') {
        const controls = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), input, select, textarea') || [])];
        if (!controls.length) return;
        const firstControl = controls[0];
        const lastControl = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === firstControl) { e.preventDefault(); lastControl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastControl) { e.preventDefault(); firstControl.focus(); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className="tr-sheet-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="tr-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label || title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tr-sheet-head">
          <div className="tr-sheet-grabber" aria-hidden="true" />
          <div className="tr-sheet-titlebar">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="tr-sheet-title">{title}</div>
              {subtitle && <div className="tr-sheet-subtitle">{subtitle}</div>}
            </div>
            {headerAction}
            <button type="button" className="tr-sheet-close" onClick={onClose} aria-label="Close">
              <Ic d={ICONS.close} size={18} color="#6B6763" sw={2.2} />
            </button>
          </div>
          {toolbar}
        </div>
        <div className="tr-sheet-body">{children}</div>
        {footer && <div className="tr-sheet-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

function CheckCircle() {
  return (
    <span className="tr-check" aria-hidden="true">
      <Ic d={CHECK_PATH} size={14} color="white" sw={3} />
    </span>
  );
}

// ── Saved meals ─────────────────────────────────────────────────────────────

/** Button in the meal form that opens the saved-meal sheet. */
export function SavedMealTrigger({ count, currentName, onOpen }) {
  return (
    <button type="button" className="tr-picker-trigger" onClick={onOpen}>
      <span className="tr-picker-trigger-icon" aria-hidden="true">
        <Ic d={ICONS.journal2} size={18} color="#2C5F3E" sw={2} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="tr-picker-trigger-title">
          {currentName ? `Using “${currentName}”` : 'Start from a saved meal'}
        </span>
        <span className="tr-picker-trigger-sub">
          {currentName ? 'Tap to pick a different one' : `${count} saved · fills in the name and ingredients`}
        </span>
      </span>
      <Ic d={ICONS.chevR} size={18} color="#A09D99" sw={2.2} />
    </button>
  );
}

export function SavedMealSheet({ savedMeals, selectedKey, onPick, onSaveEdit, onDelete, onClose }) {
  const [query, setQuery] = useState('');
  const [managing, setManaging] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [editName, setEditName] = useState('');
  const [editSlot, setEditSlot] = useState('dinner');
  const [editIngredients, setEditIngredients] = useState('');

  const groups = useMemo(() => {
    const q = keyOf(query);
    const matches = savedMeals.filter((meal) => (
      !q
      || keyOf(meal.name).includes(q)
      || (meal.ingredients || []).some((item) => keyOf(item.name).includes(q))
    ));
    return MEAL_SLOTS
      .map((slot) => ({
        slot,
        label: SLOT_LABEL[slot],
        items: matches.filter((meal) => (MEAL_SLOTS.includes(normalizeMealSlot(meal.slot)) ? normalizeMealSlot(meal.slot) : 'dinner') === slot),
      }))
      .filter((group) => group.items.length > 0);
  }, [savedMeals, query]);

  function startEdit(meal) {
    setEditingKey(meal.nameKey);
    setEditName(meal.name || '');
    setEditSlot(MEAL_SLOTS.includes(normalizeMealSlot(meal.slot)) ? normalizeMealSlot(meal.slot) : 'dinner');
    setEditIngredients((meal.ingredients || []).map((item) => item.name).join(', '));
  }

  function commitEdit() {
    if (!editingKey || !editName.trim()) return;
    onSaveEdit(editingKey, { name: editName.trim(), slot: editSlot, ingredients: splitNames(editIngredients) });
    setEditingKey(null);
  }

  return (
    <Sheet
      title="Saved meals"
      subtitle={managing ? 'Edit or remove meals in your shared library' : 'Pick one to fill in the name and ingredients'}
      onClose={onClose}
      headerAction={(
        <button
          type="button"
          className="tr-text-btn"
          aria-pressed={managing}
          onClick={() => { setManaging((on) => !on); setEditingKey(null); }}
        >
          {managing ? 'Done' : 'Manage'}
        </button>
      )}
      toolbar={(
        <input
          type="search"
          className="tr-sheet-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search meals or ingredients"
          aria-label="Search saved meals"
          data-autofocus
        />
      )}
    >
      {groups.length === 0 && (
        <div className="tr-empty">No saved meals match “{query}”.</div>
      )}
      {groups.map((group) => (
        <section key={group.slot} aria-label={group.label}>
          <div className="tr-group-label">
            <SlotIcon slot={group.slot} size={18} />
            {group.label}
            <span className="tr-group-count">{group.items.length}</span>
          </div>
          <ul className="tr-list">
            {group.items.map((meal) => {
              const ingredientNames = (meal.ingredients || []).map((item) => item.name);
              const meta = ingredientNames.length
                ? `${ingredientNames.length} ingredient${ingredientNames.length === 1 ? '' : 's'} · ${ingredientNames.slice(0, 4).join(', ')}${ingredientNames.length > 4 ? '…' : ''}`
                : 'No ingredients saved';

              if (managing && editingKey === meal.nameKey) {
                return (
                  <li key={meal.nameKey} className="tr-edit-card">
                    <label className="tr-field-label" htmlFor={`saved-name-${meal.nameKey}`}>Name</label>
                    <input
                      id={`saved-name-${meal.nameKey}`}
                      className="tr-input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                    <div className="tr-field-label">Meal</div>
                    <div className="tr-tabs tr-tabs-wrap">
                      {MEAL_SLOTS.map((slot) => (
                        <button key={slot} type="button" className="tr-tab" aria-pressed={editSlot === slot} onClick={() => setEditSlot(slot)}>
                          {SLOT_LABEL[slot]}
                        </button>
                      ))}
                    </div>
                    <label className="tr-field-label" htmlFor={`saved-ings-${meal.nameKey}`}>Ingredients (comma separated)</label>
                    <textarea
                      id={`saved-ings-${meal.nameKey}`}
                      className="tr-input"
                      rows={3}
                      value={editIngredients}
                      onChange={(e) => setEditIngredients(e.target.value)}
                    />
                    <div className="tr-edit-actions">
                      <button type="button" className="tr-mini-btn" onClick={() => setEditingKey(null)}>Cancel</button>
                      <button type="button" className="tr-mini-btn primary" onClick={commitEdit}>Save meal</button>
                    </div>
                  </li>
                );
              }

              if (managing) {
                return (
                  <li key={meal.nameKey} className="tr-row tr-row-static">
                    <div className="tr-row-main">
                      <div className="tr-row-title">{meal.name}</div>
                      <div className="tr-row-meta">{meta}</div>
                    </div>
                    <button type="button" className="tr-mini-btn" onClick={() => startEdit(meal)} aria-label={`Edit ${meal.name}`}>Edit</button>
                    <button type="button" className="tr-mini-btn danger" onClick={() => onDelete(meal)} aria-label={`Delete ${meal.name}`}>Delete</button>
                  </li>
                );
              }

              const selected = meal.nameKey === selectedKey;
              return (
                <li key={meal.nameKey}>
                  <button type="button" className="tr-row" aria-pressed={selected} onClick={() => onPick(meal)}>
                    <div className="tr-row-main">
                      <div className="tr-row-title">{meal.name}</div>
                      <div className="tr-row-meta">{meta}</div>
                    </div>
                    {selected
                      ? <CheckCircle />
                      : <Ic d={ICONS.chevR} size={18} color="#A09D99" sw={2.2} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Sheet>
  );
}

// ── Ingredients ─────────────────────────────────────────────────────────────

/**
 * Compact ingredient field for the meal form: the meal's ingredients as removable chips,
 * a quick-add box that suggests saved ingredients as you type, and a Browse button that
 * opens the full library in a sheet.
 */
export function IngredientField({ selected, library, draft, onDraftChange, onChange }) {
  const [sheetTab, setSheetTab] = useState(null); // null = closed, else initial tab id
  const [expanded, setExpanded] = useState(false);

  const ordered = useMemo(() => sortIngredients(selected, 'category'), [selected]);
  const selectedKeys = useMemo(() => new Set(selected.map(keyOf)), [selected]);
  const suggestions = useMemo(
    () => matchIngredients(library, draft.split(',').pop(), selectedKeys, 5),
    [library, draft, selectedKeys],
  );

  const CHIP_LIMIT = 8;
  const visible = expanded ? ordered : ordered.slice(0, CHIP_LIMIT);
  const hidden = ordered.length - visible.length;

  function remove(name) {
    onChange(selected.filter((item) => keyOf(item) !== keyOf(name)));
  }

  function add(names) {
    const next = [...selected];
    const keys = new Set(next.map(keyOf));
    for (const name of names) {
      const key = keyOf(name);
      if (key && !keys.has(key)) {
        keys.add(key);
        next.push(name.trim());
      }
    }
    onChange(next);
  }

  function addDraft() {
    const names = splitNames(draft);
    if (!names.length) return;
    // Use the library's spelling when a typed name matches a saved ingredient.
    const byKey = new Map(library.map((name) => [keyOf(name), name]));
    add(names.map((name) => byKey.get(keyOf(name)) || name));
    onDraftChange('');
  }

  function pickSuggestion(name) {
    // Keep anything typed before the last comma, replace the partial word with the suggestion.
    const earlier = splitNames(draft.split(',').slice(0, -1).join(','));
    add([...earlier, name]);
    onDraftChange('');
  }

  function toggle(name) {
    if (selectedKeys.has(keyOf(name))) remove(name);
    else add([name]);
  }

  return (
    <div className="tr-ing-field">
      <div className="tr-ing-head">
        <span className="tr-field-label" style={{ margin: 0 }}>
          Ingredients{selected.length ? ` · ${selected.length}` : ''}
        </span>
        {library.length > 0 && (
          <button type="button" className="tr-text-btn" onClick={() => setSheetTab('all')}>
            Browse saved ({library.length})
          </button>
        )}
      </div>

      {ordered.length > 0 ? (
        <div className="tr-chip-wrap">
          {visible.map((name) => (
            <span key={keyOf(name)} className="tr-chip">
              {name}
              <button type="button" className="tr-chip-x" aria-label={`Remove ${name}`} onClick={() => remove(name)}>×</button>
            </span>
          ))}
          {hidden > 0 && (
            <button type="button" className="tr-chip tr-chip-more" onClick={() => setExpanded(true)}>+{hidden} more</button>
          )}
          {expanded && ordered.length > CHIP_LIMIT && (
            <button type="button" className="tr-chip tr-chip-more" onClick={() => setExpanded(false)}>Show less</button>
          )}
        </div>
      ) : (
        <div className="tr-ing-empty">Type below, or browse your saved ingredients.</div>
      )}

      <div className="tr-ing-add">
        <input
          className="tr-input"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addDraft();
            }
          }}
          placeholder="Add an ingredient"
          aria-label="Add an ingredient"
          enterKeyHint="done"
          autoComplete="off"
        />
        <button type="button" className="tr-mini-btn primary" onClick={addDraft} disabled={!draft.trim()}>Add</button>
      </div>

      {suggestions.length > 0 && (
        <div className="tr-chip-wrap" aria-label="Suggestions" style={{ marginTop: 8 }}>
          {suggestions.map((name) => (
            <button key={keyOf(name)} type="button" className="tr-suggest" onClick={() => pickSuggestion(name)}>
              + {name}
            </button>
          ))}
        </div>
      )}

      {sheetTab && (
        <IngredientSheet
          library={library}
          selected={selected}
          initialTab={sheetTab}
          onToggle={toggle}
          onAdd={(name) => add([name])}
          onClose={() => setSheetTab(null)}
        />
      )}
    </div>
  );
}

function IngredientSheet({ library, selected, initialTab = 'all', onToggle, onAdd, onClose }) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState(initialTab);
  const selectedKeys = useMemo(() => new Set(selected.map(keyOf)), [selected]);

  // Everything you could pick: the library plus anything typed into this meal that is not saved yet.
  const universe = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const name of [...library, ...selected]) {
      const key = keyOf(name);
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(name);
      }
    }
    return out;
  }, [library, selected]);

  const counts = useMemo(() => {
    const map = new Map(INGREDIENT_CATEGORIES.map((c) => [c.id, 0]));
    for (const name of universe) {
      const cat = classifyIngredientCategory(name);
      map.set(cat, (map.get(cat) || 0) + 1);
    }
    return map;
  }, [universe]);

  const tabs = [
    { id: 'all', label: 'All', count: universe.length },
    { id: 'selected', label: 'In this meal', count: selected.length },
    ...INGREDIENT_CATEGORIES
      .filter((c) => counts.get(c.id))
      .map((c) => ({ id: c.id, label: c.shortLabel, icon: c.icon, count: counts.get(c.id) })),
  ];

  const q = keyOf(query);
  const filtered = universe.filter((name) => {
    if (q && !keyOf(name).includes(q)) return false;
    if (tab === 'selected') return selectedKeys.has(keyOf(name));
    if (tab !== 'all') return classifyIngredientCategory(name) === tab;
    return true;
  });
  const exactMatch = q && universe.some((name) => keyOf(name) === q);

  // Group by aisle when browsing everything without a search, otherwise a flat sorted list.
  const sections = (tab === 'all' && !q)
    ? INGREDIENT_CATEGORIES
      .map((c) => ({ ...c, items: sortIngredients(filtered.filter((name) => classifyIngredientCategory(name) === c.id), 'alpha') }))
      .filter((s) => s.items.length > 0)
    : [{ id: 'flat', label: null, items: sortIngredients(filtered, 'alpha') }];

  function addTyped() {
    const name = query.trim();
    if (!name) return;
    const existing = universe.find((item) => keyOf(item) === keyOf(name));
    if (existing) {
      if (!selectedKeys.has(keyOf(existing))) onToggle(existing);
    } else {
      onAdd(name);
    }
    setQuery('');
  }

  return (
    <Sheet
      title="Ingredients"
      subtitle="Tap to add or remove. Sorted by store aisle."
      onClose={onClose}
      toolbar={(
        <>
          <input
            type="search"
            className="tr-sheet-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTyped();
              }
            }}
            placeholder="Search or add an ingredient"
            aria-label="Search or add an ingredient"
            enterKeyHint="done"
            autoComplete="off"
            data-autofocus
          />
          <div className="tr-tabs" role="toolbar" aria-label="Filter by aisle">
            {tabs.map((t) => (
              <button key={t.id} type="button" className="tr-tab" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
                {t.icon && <span aria-hidden="true">{t.icon}</span>}
                {t.label}
                <span className="tr-tab-count">{t.count}</span>
              </button>
            ))}
          </div>
        </>
      )}
      footer={(
        <button type="button" className="tr-primary" onClick={onClose}>
          Done · {selected.length} in this meal
        </button>
      )}
    >
      {q && !exactMatch && (
        <ul className="tr-list" style={{ marginBottom: 12 }}>
          <li>
            <button type="button" className="tr-row" onClick={addTyped}>
              <span className="tr-check tr-check-add" aria-hidden="true">
                <Ic d={ICONS.plus} size={14} color="#2C5F3E" sw={3} />
              </span>
              <div className="tr-row-main">
                <div className="tr-row-title">Add “{query.trim()}”</div>
                <div className="tr-row-meta">New ingredient · {getIngredientCategoryMeta(classifyIngredientCategory(query)).label}</div>
              </div>
            </button>
          </li>
        </ul>
      )}

      {filtered.length === 0 && !q && (
        <div className="tr-empty">
          {tab === 'selected' ? 'Nothing in this meal yet.' : 'No ingredients here yet.'}
        </div>
      )}

      {sections.map((section) => (
        <section key={section.id} aria-label={section.label || undefined}>
          {section.label && (
            <div className="tr-group-label">
              <span aria-hidden="true">{section.icon}</span>
              {section.label}
              <span className="tr-group-count">{section.items.length}</span>
            </div>
          )}
          {section.items.length > 0 && (
            <ul className="tr-list">
              {section.items.map((name) => {
                const isOn = selectedKeys.has(keyOf(name));
                return (
                  <li key={keyOf(name)}>
                    <button type="button" className="tr-row tr-row-compact" aria-pressed={isOn} onClick={() => onToggle(name)}>
                      <CheckCircle />
                      <div className="tr-row-main">
                        <div className="tr-row-title">{name}</div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </Sheet>
  );
}

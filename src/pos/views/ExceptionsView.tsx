import React, { useEffect, useState } from 'react';
import { db, type OutboxItem } from '../offline/db';
import { exceptions } from '../offline/outbox';

export default function ExceptionsView(): React.ReactElement {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => { void db.outbox.orderBy('createdAt').toArray().then((q) => setItems(exceptions(q))); }, []);
  if (items.length === 0) return <p className="p-8 text-center text-gray-400">—</p>;
  return (
    <ul className="divide-y">
      {items.map((i) => (
        <li key={i.localId} className="flex justify-between px-4 py-3 text-sm">
          <span>{i.type} · {i.clientShiftId.slice(-6)}</span>
          <span className="text-red-600">{i.error}</span>
        </li>
      ))}
    </ul>
  );
}

import React from 'react';
import { NotesLog } from './NotesLog';

interface ClientAccountNotesProps {
  clientId: string;
}

export function ClientAccountNotes({ clientId }: ClientAccountNotesProps) {
  return (
    <div className="mt-2">
      <NotesLog
        table="client_notes"
        foreignKey="client_id"
        foreignId={clientId}
        queryKey={['client-notes', clientId]}
      />
    </div>
  );
}

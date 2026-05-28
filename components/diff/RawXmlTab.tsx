'use client';

import React, { useState } from 'react';
import type { Edit } from '@/lib/osc/types';

interface RawXmlTabProps {
  edit: Edit;
}

const RawXmlTab: React.FC<RawXmlTabProps> = ({ edit }) => {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(edit.rawXml).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      },
      () => undefined,
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500">
          osmChange fragment
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="text-[10px] font-mono text-indigo-400 hover:text-indigo-300"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre className="bg-gray-950 border border-gray-800 rounded p-2 text-[11px] text-gray-300 font-mono overflow-x-auto whitespace-pre">
        {edit.rawXml}
      </pre>
    </div>
  );
};

export default RawXmlTab;

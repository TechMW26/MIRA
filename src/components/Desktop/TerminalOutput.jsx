import { Fragment } from 'react';
import { normalizeLocalPreviewUrl } from '../../services/localPreview.js';

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/gi;

export default function TerminalOutput({ value, onOpenLocal }) {
  return String(value || '').split(URL_PATTERN).map((part, index) => {
    if (!/^https?:\/\//i.test(part)) return <Fragment key={`${index}:${part.slice(0, 12)}`}>{part}</Fragment>;
    const trailing = part.match(/[),.;]+$/)?.[0] || '';
    const url = trailing ? part.slice(0, -trailing.length) : part;
    const localUrl = normalizeLocalPreviewUrl(url);
    return (
      <Fragment key={`${index}:${url}`}>
        <a
          href={url}
          target={localUrl ? undefined : '_blank'}
          rel="noreferrer"
          onClick={(event) => {
            if (!localUrl) return;
            event.preventDefault();
            onOpenLocal(localUrl);
          }}
        >
          {url}
        </a>
        {trailing}
      </Fragment>
    );
  });
}

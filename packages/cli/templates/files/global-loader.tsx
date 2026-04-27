'use client';

import { useInterruptiveLoadStore } from 'monorise/react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const GlobalLoader = () => {
  const { isLoading, message } = useInterruptiveLoadStore();
  const [mount, setMount] = useState(false);

  useEffect(() => {
    if (!isLoading && mount) {
      setTimeout(() => {
        setMount(false);
      }, 100);
    } else if (!mount && isLoading) {
      setMount(true);
    }
  }, [isLoading, mount]);

  const renderLoader = () => {
    return (
      <div
        data-state={isLoading ? 'open' : 'closed'}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 transition-opacity data-[state=open]:opacity-100 data-[state=closed]:opacity-0"
      >
        <div className="flex flex-col items-center gap-4 rounded-xl bg-white px-10 py-8 shadow-lg">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-600" />
          <span className="text-sm text-gray-600">
            {message || 'Loading...'}
          </span>
        </div>
      </div>
    );
  };

  return mount
    ? createPortal(
        renderLoader(),
        document.querySelector('#loader-portal') as HTMLElement,
      )
    : null;
};

export default GlobalLoader;

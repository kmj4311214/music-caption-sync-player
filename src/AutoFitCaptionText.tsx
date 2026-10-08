import { useLayoutEffect, useRef } from 'react';

type AutoFitCaptionTextProps = {
  text: string;
  expanded: boolean;
};

export function AutoFitCaptionText({ text, expanded }: AutoFitCaptionTextProps) {
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const element = textRef.current;
    const container = element?.parentElement;
    if (!element || !container) {
      return;
    }

    let disposed = false;
    const fitText = () => {
      const availableWidth = container.clientWidth;
      if (disposed || availableWidth <= 1) {
        return;
      }

      // Measure at the preferred size so shorter lines can grow again.
      const maximumSize = Number.parseFloat(getComputedStyle(container).fontSize);
      element.style.fontSize = `${maximumSize}px`;
      const textWidth = element.getBoundingClientRect().width;
      if (textWidth > 0) {
        const fittedSize = maximumSize * Math.min(1, (availableWidth - 1) / textWidth);
        element.style.fontSize = `${Math.floor(fittedSize * 100) / 100}px`;
      }
    };

    fitText();
    const observer = new ResizeObserver(fitText);
    observer.observe(container);
    void document.fonts.ready.then(fitText);
    document.fonts.addEventListener('loadingdone', fitText);

    return () => {
      disposed = true;
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', fitText);
    };
  }, [text, expanded]);

  return <span className="caption-text" ref={textRef}>{text}</span>;
}

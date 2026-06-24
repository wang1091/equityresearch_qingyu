import DOMPurify from 'dompurify';
import React from 'react';

interface SafeHtmlContentProps {
  html: string;
  className?: string;
  allowedTags?: string[];
  allowedAttributes?: Record<string, string[]>;
}

/**
 * SafeHtmlContent Component
 * 
 * Renders HTML content safely by sanitizing with DOMPurify
 * Prevents XSS attacks by removing dangerous scripts and event handlers
 * 
 * @param html - HTML string to render
 * @param className - CSS class to apply to the wrapper div
 * @param allowedTags - Custom whitelist of allowed HTML tags
 * @param allowedAttributes - Custom whitelist of allowed attributes
 */
export const SafeHtmlContent: React.FC<SafeHtmlContentProps> = ({
  html,
  className = '',
  allowedTags = [
  'p', 'br', 'strong', 'em', 'i', 'b', 'u',
  'ul', 'ol', 'li', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'a', 'code', 'pre',
  'details', 'summary',
  // SVG 支持
  'svg', 'polyline', 'polygon', 'path', 'line', 'rect', 'circle',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'g', 'text', 'tspan',
],
  allowedAttributes = {
    'a': ['href', 'target', 'rel', 'class'],
    'div': ['class'],
    'span': ['class'],
    'p': ['class'],
    'code': ['class'],
    'pre': ['class'],
    'table': ['class'],
    'thead': ['class'],
    'tbody': ['class'],
    'tr': ['class'],
    'td': ['class'],
    'th': ['class'],
    '*': ['class', 'style']
  }
}) => {
  // Configure DOMPurify with strict defaults
  const config = {
  ALLOWED_TAGS: allowedTags,
  ALLOWED_ATTR: [
    'href', 'target', 'rel', 'class', 'style', 'open',
    // SVG 属性
    'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linejoin', 'stroke-linecap',
    'points', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r',
    'x', 'y', 'width', 'height', 'offset',
    'stop-color', 'stop-opacity',
    'id', 'gradientUnits',
  ],
  KEEP_CONTENT: true,
  FORCE_BODY: false,
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

  // Sanitize the HTML
  const sanitizedHtml = DOMPurify.sanitize(html, config);

  return (
    <div
      className={`${className} safe-html-content`}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      data-testid="safe-html-content"
    />
  );
};

SafeHtmlContent.displayName = 'SafeHtmlContent';

export default SafeHtmlContent;

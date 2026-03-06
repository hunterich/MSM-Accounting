export function Modal({ title, content, footer, onClose, size = 'medium' }) {
    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    // Modal Container
    const modal = document.createElement('div');
    modal.className = `modal modal-${size}`;

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';

    const titleEl = document.createElement('h3');
    titleEl.className = 'modal-title';
    titleEl.textContent = title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => {
        if (onClose) onClose();
        document.body.removeChild(overlay);
    });

    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'modal-body';
    if (typeof content === 'string') {
        body.innerHTML = content;
    } else if (content instanceof Node) {
        body.appendChild(content);
    }
    modal.appendChild(body);

    // Footer
    if (footer) {
        const footerEl = document.createElement('div');
        footerEl.className = 'modal-footer';
        if (typeof footer === 'string') {
            footerEl.innerHTML = footer;
        } else if (footer instanceof Node) {
            footerEl.appendChild(footer);
        }
        modal.appendChild(footerEl);
    }

    overlay.appendChild(modal);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            if (onClose) onClose();
            document.body.removeChild(overlay);
        }
    });

    return overlay;
}

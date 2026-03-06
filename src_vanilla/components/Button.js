export function Button({ text, variant = 'primary', size = 'medium', type = 'button', onClick, disabled = false, icon = null, className = '' }) {
    const btn = document.createElement('button');
    btn.type = type;
    btn.className = `btn btn-${variant} btn-${size} ${className}`;
    btn.disabled = disabled;

    if (icon) {
        // Assuming we might use an icon library later, implemented as simple text for now or passed element
        const iconSpan = document.createElement('span');
        iconSpan.className = 'btn-icon';
        iconSpan.innerHTML = icon; // Expecting SVG string or similar
        btn.appendChild(iconSpan);
    }

    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    btn.appendChild(textSpan);

    if (onClick && !disabled) {
        btn.addEventListener('click', onClick);
    }

    return btn;
}

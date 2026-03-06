export function Input({
    label,
    id,
    name,
    type = 'text',
    placeholder = '',
    value = '',
    required = false,
    disabled = false,
    error = null,
    onChange
}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-group';

    if (label) {
        const labelEl = document.createElement('label');
        labelEl.htmlFor = id;
        labelEl.className = 'form-label';
        labelEl.textContent = label;
        if (required) {
            const reqSpan = document.createElement('span');
            reqSpan.className = 'text-danger';
            reqSpan.textContent = ' *';
            labelEl.appendChild(reqSpan);
        }
        wrapper.appendChild(labelEl);
    }

    const input = document.createElement('input');
    input.id = id;
    input.name = name || id;
    input.type = type;
    input.className = `form-control ${error ? 'is-invalid' : ''}`;
    input.placeholder = placeholder;
    input.value = value;
    input.disabled = disabled;
    if (required) input.required = true;

    if (onChange) {
        input.addEventListener('input', (e) => onChange(e.target.value));
    }

    wrapper.appendChild(input);

    if (error) {
        const errorEl = document.createElement('div');
        errorEl.className = 'form-feedback invalid-feedback';
        errorEl.textContent = error;
        wrapper.appendChild(errorEl);
    }

    return wrapper;
}

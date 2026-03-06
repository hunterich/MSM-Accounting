export function Card({ title, content, footer, className = '', padding = true, actions = null }) {
    const card = document.createElement('div');
    card.className = `card ${className}`;

    if (title || actions) {
        const header = document.createElement('div');
        header.className = 'card-header';

        if (title) {
            const titleEl = document.createElement('h3');
            titleEl.className = 'card-title';
            titleEl.textContent = title;
            header.appendChild(titleEl);
        }

        if (actions) {
            const actionsEl = document.createElement('div');
            actionsEl.className = 'card-actions';
            if (actions instanceof Node) {
                actionsEl.appendChild(actions);
            } else {
                actionsEl.innerHTML = actions;
            }
            header.appendChild(actionsEl);
        }

        card.appendChild(header);
    }

    const body = document.createElement('div');
    body.className = `card-body ${padding ? 'p-4' : 'p-0'}`;

    if (typeof content === 'string') {
        body.innerHTML = content;
    } else if (content instanceof Node) {
        body.appendChild(content);
    }
    card.appendChild(body);

    if (footer) {
        const footerEl = document.createElement('div');
        footerEl.className = 'card-footer';
        if (typeof footer === 'string') {
            footerEl.innerHTML = footer;
        } else if (footer instanceof Node) {
            footerEl.appendChild(footer);
        }
        card.appendChild(footerEl);
    }

    return card;
}

import React from 'react';
import { formatNumber } from '../../utils/formatters';

const RecordCount = ({ count = 0, label = 'records', className = '' }) => {
    return (
        <div className={`table-count-bar ${className}`}>
            {formatNumber(count)} {label}
        </div>
    );
};

export default RecordCount;

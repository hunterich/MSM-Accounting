import React from 'react';
import { formatNumber } from '../../utils/formatters';

interface RecordCountProps {
    count?: number;
    label?: string;
    className?: string;
}

const RecordCount = ({ count = 0, label = 'records', className = '' }: RecordCountProps): React.ReactElement => {
    return (
        <div className={`table-count-bar ${className}`}>
            {formatNumber(count)} {label}
        </div>
    );
};

export default RecordCount;

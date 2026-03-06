import React from 'react';
import ListPage from '../../components/Layout/ListPage';
import Card from '../../components/UI/Card';

const Attendance = () => {
    return (
        <ListPage
            containerClassName="hr-module"
            title="Attendance"
            subtitle="Track employee attendance and time records."
        >
            <Card>
                <div className="p-2">
                    <h3 className="text-lg font-semibold text-neutral-800 mb-1">Coming Soon</h3>
                    <p className="text-sm text-neutral-600">
                        Attendance management is prepared in navigation and permissions. Detailed workflows will be added in the next HR sprint.
                    </p>
                </div>
            </Card>
        </ListPage>
    );
};

export default Attendance;

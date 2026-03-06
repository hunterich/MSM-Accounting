import React from 'react';
import ListPage from '../../components/Layout/ListPage';
import Card from '../../components/UI/Card';

const PayrollRun = () => {
    return (
        <ListPage
            containerClassName="hr-module"
            title="Payroll Run"
            subtitle="Prepare and execute payroll processing."
        >
            <Card>
                <div className="p-2">
                    <h3 className="text-lg font-semibold text-neutral-800 mb-1">Coming Soon</h3>
                    <p className="text-sm text-neutral-600">
                        Payroll run setup is ready in navigation and access control. Processing periods, calculations, and posting flow will be implemented next.
                    </p>
                </div>
            </Card>
        </ListPage>
    );
};

export default PayrollRun;

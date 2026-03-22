import { Component } from 'react';

export class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('[ErrorBoundary]', error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback({ error: this.state.error, reset: this.handleReset });
            }

            return (
                <div className="flex flex-col items-center justify-center p-8 text-center">
                    <div className="rounded-lg border border-red-200 bg-red-50 p-6 max-w-lg">
                        <h2 className="text-lg font-semibold text-red-800 mb-2">
                            Terjadi Kesalahan
                        </h2>
                        <p className="text-sm text-red-600 mb-4">
                            {this.state.error?.message || 'Terjadi kesalahan yang tidak terduga.'}
                        </p>
                        <button
                            onClick={this.handleReset}
                            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
                        >
                            Coba Lagi
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export function PageErrorFallback({ error, reset }) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
            <div className="rounded-lg border border-red-200 bg-red-50 p-8 max-w-lg">
                <div className="text-4xl mb-4">!</div>
                <h2 className="text-lg font-semibold text-red-800 mb-2">
                    Halaman Tidak Dapat Dimuat
                </h2>
                <p className="text-sm text-red-600 mb-4">
                    {error?.message || 'Terjadi kesalahan saat memuat halaman ini.'}
                </p>
                <div className="flex gap-3 justify-center">
                    <button
                        onClick={reset}
                        className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
                    >
                        Coba Lagi
                    </button>
                    <button
                        onClick={() => window.location.href = '/'}
                        className="px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50"
                    >
                        Kembali ke Dashboard
                    </button>
                </div>
            </div>
        </div>
    );
}

export function WidgetErrorFallback({ error, reset }) {
    return (
        <div className="flex flex-col items-center justify-center p-4 text-center h-full">
            <p className="text-xs text-red-500 mb-2">Widget error</p>
            <button
                onClick={reset}
                className="text-xs text-red-600 underline hover:text-red-800"
            >
                Retry
            </button>
        </div>
    );
}

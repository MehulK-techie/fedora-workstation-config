/**
 * Manages GObject signal connections to prevent leaks.
 * Every connect() must be paired with a disconnectAll() in disable().
 */
export class SignalManager {
    _connections = [];
    connect(source, signal, callback) {
        const id = source.connect(signal, callback);
        this._connections.push({ source, signalId: id });
        return id;
    }
    disconnect(id) {
        const index = this._connections.findIndex((c) => c.signalId === id);
        if (index !== -1) {
            const [conn] = this._connections.splice(index, 1);
            conn.source.disconnect(conn.signalId);
        }
    }
    disconnectAll() {
        for (const conn of this._connections) {
            conn.source.disconnect(conn.signalId);
        }
        this._connections = [];
    }
}

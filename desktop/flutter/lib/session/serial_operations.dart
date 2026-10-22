/// Orders native mutations while allowing the owner to observe each failure.
class SerialOperations {
  Future<void> _tail = Future.value();
  Future<void> get settled => _tail;

  Future<void> run(Future<void> Function() action) {
    final operation = _tail.then((_) => action());
    _tail = operation.catchError((Object _) {});
    return operation;
  }
}

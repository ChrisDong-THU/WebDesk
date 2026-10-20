import 'dart:async';

/// Cleanup is ordered, but no failed resource may prevent the next release.
class CleanupException implements Exception {
  CleanupException(this.failures);
  final Map<String, Object> failures;
  @override
  String toString() =>
      '资源释放失败: ${failures.entries.map((e) => '${e.key}: ${e.value}').join('; ')}';
}

Future<void> cleanup(Map<String, FutureOr<void> Function()> actions) async {
  final failures = <String, Object>{};
  for (final entry in actions.entries) {
    try {
      await entry.value();
    } catch (error) {
      failures[entry.key] = error;
    }
  }
  if (failures.isNotEmpty) throw CleanupException(failures);
}

export function batchSummary(batch) {
  const checked = batch.records.filter((record) => record.checkedAt).length;
  return { total: batch.records.length, checked, pending: batch.records.length - checked,
    added: batch.records.filter((record) => !record.digital).length };
}
export function batchReportRows(batch, generatedAt) {
  const summary = batchSummary(batch);
  const people = new Map(batch.workers.map((worker) => [worker.id, worker.name]));
  return [['REPORTE DE CIERRE FUP'], ['Archivo', batch.fileName], ['QNA', batch.qna], ['Generado', generatedAt],
    ['Estado', summary.pending ? 'Con pendientes' : 'Revisión completa'],
    ['Total', summary.total], ['Revisados', summary.checked], ['Pendientes', summary.pending], ['Añadidos manualmente', summary.added], [],
    ['Persona asignada', 'Total', 'Revisados', 'Pendientes'],
    ...[...batch.workers, {id: null, name: 'Sin asignar'}].map((worker) => {
      const records = batch.records.filter((record) => (record.assignedWorkerId || null) === worker.id);
      const done = records.filter((record) => record.checkedAt).length;
      return [worker.name, records.length, done, records.length - done];
    }), [],
    ['RFC', 'Folio', 'Asignado', 'Estado', 'Responsable de revisión', 'Fecha de revisión', 'Procedencia', 'Nivel', 'Fecha documento', 'Origen', 'Observación'],
    ...batch.records.map((record) => [record.rfc, record.folio, people.get(record.assignedWorkerId) || 'Sin asignar',
      record.checkedAt ? 'Revisado' : 'Pendiente', record.checkedBy, record.checkedAt, record.procedencia, record.nivel,
      record.documentDate, record.digital ? 'Excel' : 'Añadido manualmente', record.observation])];
}

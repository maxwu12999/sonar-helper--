import { handleAnalysisWorkerRequest } from './analysisWorkerHandler'
import type { AnalysisWorkerResponse } from './analysisWorkerProtocol'

interface AnalysisWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ): void
  postMessage(message: AnalysisWorkerResponse): void
}

const workerScope = self as unknown as AnalysisWorkerScope

workerScope.addEventListener('message', (event) => {
  workerScope.postMessage(handleAnalysisWorkerRequest(event.data))
})

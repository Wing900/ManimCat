import type { StudioModelPort, StudioModelRequest, StudioModelResponse } from '../../model/studio-model-port'

export class ScriptedStudioModel implements StudioModelPort {
  readonly requests: StudioModelRequest[] = []
  private readonly responses: StudioModelResponse[]

  constructor(responses: StudioModelResponse[]) {
    this.responses = [...responses]
  }

  async complete(request: StudioModelRequest): Promise<StudioModelResponse> {
    this.requests.push(request)
    const response = this.responses.shift()
    if (!response) {
      throw new Error('ScriptedStudioModel ran out of responses')
    }
    return response
  }
}

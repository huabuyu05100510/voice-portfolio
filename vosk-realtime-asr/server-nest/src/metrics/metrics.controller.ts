import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * Prometheus 拉取端点
 * GET http://localhost:<PORT>/metrics
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsSvc: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async expose(): Promise<string> {
    return this.metricsSvc.metrics();
  }
}

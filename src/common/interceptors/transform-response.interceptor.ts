import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface WrappedResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

@Injectable()
export class TransformResponseInterceptor<T>
  implements NestInterceptor<T, WrappedResponse<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<WrappedResponse<T>> {
    return next.handle().pipe(
      map((responseData) => {
        if (responseData && typeof responseData === 'object' && 'data' in responseData) {
          return responseData as WrappedResponse<T>;
        }
        return { data: responseData };
      }),
    );
  }
}

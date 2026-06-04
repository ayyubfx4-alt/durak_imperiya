export class StickerRepositoryInterface {
  async getAll(_filters, _pagination) {
    throw new Error('StickerRepositoryInterface.getAll must be implemented');
  }

  async findById(_id) {
    throw new Error('StickerRepositoryInterface.findById must be implemented');
  }

  async create(_data) {
    throw new Error('StickerRepositoryInterface.create must be implemented');
  }

  async update(_id, _data) {
    throw new Error('StickerRepositoryInterface.update must be implemented');
  }

  async delete(_id) {
    throw new Error('StickerRepositoryInterface.delete must be implemented');
  }

  async stats() {
    throw new Error('StickerRepositoryInterface.stats must be implemented');
  }
}
